/// Turning pool Swap events into positions, incrementally.
///
/// Arc produces ~169,000 blocks a day and the RPC caps eth_getLogs at 10,000
/// blocks, so keeping current costs roughly seventeen calls per pool per day
/// before any backfill. That budget, not the arithmetic, is what shapes this file:
/// every run is bounded, every pool keeps its own cursor, and a run that is cut
/// short resumes exactly where it stopped rather than starting again.
///
/// Attribution comes from the pad's own router. Uniswap v4 keeps every pool in
/// one manager and its Swap event names the contract that called it, not the
/// person who asked -- indexing the manager alone would credit every trade on
/// the site to the router. The router therefore emits the trader itself, which
/// is what this reads. A trade routed around the site (through Uniswap's own
/// router, say) still moves the price and still shows in the pool; it just does
/// not land in anybody's position here.

import { parseAbiItem, type Address } from "viem";

import { curveAbi, launchpadAbi } from "./abi";
import { CURVE_ADDRESS, LAUNCHPAD_ADDRESS, MARKET_KEY_PREFIX as M, SWAP_ROUTER_ADDRESS, isCurveDeployed } from "./config";
import { getLogsSplit, indexerClient } from "./indexer-rpc";
import { poolIdFor } from "./v4";
import { cmd, pipeline } from "./redis";
import { EMPTY, applyBuy, applySell, type Position } from "./pnl";

export const SWAP_EVENT = parseAbiItem(
  "event Swapped(bytes32 indexed id, address indexed trader, address indexed recipient, bool zeroForOne, uint256 amountIn, uint256 amountOut)",
);

/// A buy or sell on the bonding curve, before a launch graduates. Attributed to
/// `trader`, the wallet that paid; `recipient` on a curve trade is where the
/// tokens went, which is the same wallet for every trade made from the site.
export const CURVE_TRADE_EVENT = parseAbiItem(
  "event Trade(address indexed token, address indexed trader, bool isBuy, uint256 usdcAmount, uint256 tokenAmount, uint256 fee, uint256 tokensSold, uint256 usdcRaised)",
);

/// Arc's public endpoint refuses anything over 10,000 blocks ("requested range
/// too large"), and dRPC's free tier the same. It accepted 20,000 when this was
/// written, so the ceiling can move -- held a little under it on purpose.
const CHUNK = 9_000n;

/// Bounded so one run cannot outlive a serverless invocation. Whatever is left
/// is picked up next tick.
const MAX_CHUNKS_PER_RUN = 26;
const MAX_POOLS_PER_RUN = 8;

export const K = {
  pools: `${M}idx:pools`,
  cursor: (pool: string) => `${M}idx:cur:${pool.toLowerCase()}`,
  position: (w: string, t: string) => `${M}pos:${w.toLowerCase()}:${t.toLowerCase()}`,
  traderTokens: (w: string) => `${M}pos:tokens:${w.toLowerCase()}`,
  tokenTraders: (t: string) => `${M}pos:traders:${t.toLowerCase()}`,
  traders: `${M}pos:traders`,
  volume: `${M}lb:volume`,
};

const client = indexerClient;

/// Addresses that trade but are not traders. The launchpad sells collected token
/// fees for USDC on every collection, which is a real swap with a real profit,
/// and counting it would put the protocol at the top of its own leaderboard.
const NOT_A_TRADER = new Set<string>([LAUNCHPAD_ADDRESS.toLowerCase(), CURVE_ADDRESS.toLowerCase()]);

/// A source of trades for one token. Either a Uniswap pool, or -- for a curve
/// launch -- the curve contract itself, whose trades are filtered by token. A
/// graduated curve launch has both: its curve history and then its pool.
export type PoolRef = { pool: string; token: string; createdAt: number; curve?: boolean };

/// Cursor key for a curve launch's trades. The curve is one contract shared by
/// every launch, so the cursor has to be per token rather than per address.
const curveKey = (token: string) => `curve:${token.toLowerCase()}`;

/// One trade, whichever contract it came from.
type TradeRow = { who: string; buy: boolean; usdc: bigint; tokens: bigint };

function fromSwap(log: { args: unknown }): TradeRow | null {
  const a = log.args as {
    trader?: Address;
    zeroForOne?: boolean;
    amountIn?: bigint;
    amountOut?: bigint;
  };
  if (!a.trader || a.zeroForOne === undefined || a.amountIn === undefined || a.amountOut === undefined) {
    return null;
  }
  // currency0 is the launch token, currency1 is USDC, so zeroForOne is a sell.
  const buy = !a.zeroForOne;
  return {
    who: a.trader.toLowerCase(),
    buy,
    usdc: buy ? a.amountIn : a.amountOut,
    tokens: buy ? a.amountOut : a.amountIn,
  };
}

function fromCurveTrade(log: { args: unknown }): TradeRow | null {
  const a = log.args as { trader?: Address; isBuy?: boolean; usdcAmount?: bigint; tokenAmount?: bigint };
  if (!a.trader || a.isBuy === undefined || a.usdcAmount === undefined || a.tokenAmount === undefined) return null;
  return { who: a.trader.toLowerCase(), buy: a.isBuy, usdc: a.usdcAmount, tokens: a.tokenAmount };
}

/// Arc produces a block roughly every 0.51 seconds. Used only to estimate where
/// a pool began, never to decide what has been indexed -- cursors do that.
const BLOCK_SECONDS = 0.51;

/// A pool first seen by the indexer has to be walked from its own launch, not
/// from an arbitrary window, or its early trades are invisible forever. The
/// launch timestamp gives a block estimate; the margin covers drift in the
/// average block time.
function firstBlockFor(createdAt: number, head: bigint): bigint {
  if (!createdAt) return head > CHUNK ? head - CHUNK : 0n;
  const ago = Math.max(0, Math.floor(Date.now() / 1000) - createdAt);
  const back = BigInt(Math.ceil(ago / BLOCK_SECONDS)) + CHUNK; // + one chunk of margin
  return head > back ? head - back : 0n;
}

/// Refresh the list of pools to watch, and the token each belongs to.
export async function syncPools(): Promise<PoolRef[]> {
  const pub = client();
  const raw = (await pub.readContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    functionName: "recentLaunches",
    args: [0n, 200n],
  })) as readonly { token: Address; createdAt: bigint }[];

  // A v4 "pool" is an id, not an address, and it is derivable from the token --
  // so the cursor key is the id and nothing has to be read back from the chain.
  const entries: PoolRef[] = raw.map((l) => ({
    pool: poolIdFor(l.token),
    token: l.token,
    createdAt: Number(l.createdAt),
  }));

  // Curve launches: every one has curve trades to index, and a graduated one
  // has a pool as well. Both are keyed by the token so a trader's curve buys
  // and pool sells land in the same position.
  if (isCurveDeployed) {
    const count = Number(
      (await pub.readContract({ address: CURVE_ADDRESS, abi: curveAbi, functionName: "curveCount" })) as bigint,
    );
    const from = Math.max(0, count - 200);
    const curves = await pub.multicall({
      contracts: Array.from({ length: count - from }, (_, i) => ({
        address: CURVE_ADDRESS,
        abi: curveAbi,
        functionName: "curveAt" as const,
        args: [BigInt(from + i)] as const,
      })),
      allowFailure: true,
    });
    for (const r of curves) {
      if (r.status !== "success") continue;
      const c = r.result as { token: Address; createdAt: bigint; graduated: boolean };
      const createdAt = Number(c.createdAt);
      entries.push({ pool: curveKey(c.token), token: c.token, createdAt, curve: true });
      if (c.graduated) entries.push({ pool: poolIdFor(c.token), token: c.token, createdAt });
    }
  }

  if (entries.length > 0) {
    await cmd("SET", K.pools, JSON.stringify(entries));
  }
  return entries;
}

async function loadPools(): Promise<PoolRef[]> {
  const cached = await cmd<string | null>("GET", K.pools);
  if (cached) return JSON.parse(cached);
  return syncPools();
}

/// Fold one source's new trades into the positions they belong to.
async function indexPool(
  pool: string,
  token: string,
  head: bigint,
  createdAt: number,
  curve = false,
): Promise<{ swaps: number; caughtUp: boolean }> {
  const pub = client();
  const stored = await cmd<string | null>("GET", K.cursor(pool));

  let from = stored ? BigInt(stored) + 1n : firstBlockFor(createdAt, head);

  let swaps = 0;
  let chunks = 0;

  const progress = { swaps: 0 };
  void progress;

  while (from <= head && chunks < MAX_CHUNKS_PER_RUN) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
    const rows: TradeRow[] = curve
      ? (
          await getLogsSplit(
            (lo, hi) =>
              pub.getLogs({
                address: CURVE_ADDRESS,
                event: CURVE_TRADE_EVENT,
                args: { token: token as Address },
                fromBlock: lo,
                toBlock: hi,
              }),
            from,
            to,
          )
        )
          .map(fromCurveTrade)
          .filter((r): r is TradeRow => r !== null)
      : (
          await getLogsSplit(
            (lo, hi) =>
              pub.getLogs({
                address: SWAP_ROUTER_ADDRESS,
                event: SWAP_EVENT,
                args: { id: pool as `0x${string}` },
                fromBlock: lo,
                toBlock: hi,
              }),
            from,
            to,
          )
        )
          .map(fromSwap)
          .filter((r): r is TradeRow => r !== null);

    // Group by trader so a busy chunk costs one read and one write per trader,
    // not one per swap.
    const touched = new Map<string, Position>();
    const order: string[] = [];
    for (const { who } of rows) {
      if (NOT_A_TRADER.has(who)) continue;
      if (!touched.has(who)) {
        order.push(who);
        touched.set(who, EMPTY);
      }
    }
    if (order.length > 0) {
      const existing = await pipeline<string | null>(
        order.map((w) => ["GET", K.position(w, token)]),
      );
      order.forEach((w, i) => {
        touched.set(w, existing[i] ? revive(existing[i] as string) : EMPTY);
      });
    }

    for (const r of rows) {
      if (NOT_A_TRADER.has(r.who)) continue;
      const cur = touched.get(r.who) ?? EMPTY;
      touched.set(r.who, r.buy ? applyBuy(cur, r.usdc, r.tokens) : applySell(cur, r.tokens, r.usdc));
      swaps++;
    }

    if (touched.size > 0) {
      const writes: (string | number)[][] = [];
      for (const [who, pos] of touched) {
        writes.push(["SET", K.position(who, token), serialise(pos)]);
        writes.push(["SADD", K.traderTokens(who), token.toLowerCase()]);
        writes.push(["SADD", K.tokenTraders(token), who]);
        writes.push(["SADD", K.traders, who]);
        writes.push(["ZADD", K.volume, Number(pos.boughtUsdc + pos.soldUsdc) / 1e6, who]);
      }
      await pipeline(writes);
    }

    await cmd("SET", K.cursor(pool), to.toString());
    from = to + 1n;
    chunks++;
  }

  return { swaps, caughtUp: from > head };
}

const serialise = (p: Position) =>
  JSON.stringify({
    tokens: p.tokens.toString(), costUsdc: p.costUsdc.toString(),
    realizedUsdc: p.realizedUsdc.toString(), boughtUsdc: p.boughtUsdc.toString(),
    soldUsdc: p.soldUsdc.toString(), tokensBought: p.tokensBought.toString(), trades: p.trades,
  });

export function revive(json: string): Position {
  const o = JSON.parse(json);
  return {
    tokens: BigInt(o.tokens), costUsdc: BigInt(o.costUsdc),
    realizedUsdc: BigInt(o.realizedUsdc), boughtUsdc: BigInt(o.boughtUsdc),
    soldUsdc: BigInt(o.soldUsdc), tokensBought: BigInt(o.tokensBought), trades: o.trades ?? 0,
  };
}

/// One pass. Pools furthest behind are indexed first, so a quiet pool cannot
/// starve a busy one and nothing falls permanently behind.
export async function runIndexer(): Promise<{
  pools: number; indexed: number; swaps: number; behind: number;
  head: string; errors: string[];
}> {
  const pub = client();
  const head = await pub.getBlockNumber();
  const pools = await loadPools();

  const cursors = pools.length
    ? await pipeline<string | null>(pools.map((p) => ["GET", K.cursor(p.pool)]))
    : [];
  const ranked = pools
    .map((p, i) => ({ ...p, cursor: cursors[i] ? BigInt(cursors[i] as string) : 0n }))
    .sort((a, b) => (a.cursor < b.cursor ? -1 : a.cursor > b.cursor ? 1 : 0));

  let swaps = 0;
  let indexed = 0;
  let behind = 0;
  const errors: string[] = [];

  for (const p of ranked.slice(0, MAX_POOLS_PER_RUN)) {
    try {
      const r = await indexPool(p.pool, p.token, head, p.createdAt, p.curve);
      swaps += r.swaps;
      indexed++;
      if (!r.caughtUp) behind++;
    } catch (e) {
      // A rate-limited pool is skipped, not retried into the ground. Its cursor
      // only advanced over chunks that fully succeeded, so the next run resumes
      // exactly where this one stopped -- nothing is skipped and nothing is
      // counted twice. The reason is reported rather than swallowed, because a
      // silently skipped pool looks exactly like an idle one.
      behind++;
      if (errors.length < 3) {
        errors.push(`${p.pool.slice(0, 10)}: ${e instanceof Error ? e.message.split("\n")[0] : "failed"}`);
      }
    }
  }

  return { pools: pools.length, indexed, swaps, behind, head: head.toString(), errors };
}
