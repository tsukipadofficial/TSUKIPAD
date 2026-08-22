/// Turning pool Swap events into positions, incrementally.
///
/// Arc produces ~169,000 blocks a day and the RPC caps eth_getLogs at 20,000
/// blocks, so keeping current costs roughly nine calls per pool per day before
/// any backfill. That budget, not the arithmetic, is what shapes this file:
/// every run is bounded, every pool keeps its own cursor, and a run that is cut
/// short resumes exactly where it stopped rather than starting again.
///
/// Attribution comes from the Swap event's `recipient`, which the router sets to
/// the trader rather than to itself -- so a swap made through any interface is
/// still credited to whoever actually received the tokens.

import { createPublicClient, http, parseAbiItem, type Address } from "viem";

import { launchpadAbi } from "./abi";
import { LAUNCHPAD_ADDRESS, RPC_URL, chain } from "./config";
import { cmd, pipeline } from "./redis";
import { EMPTY, applyBuy, applySell, type Position } from "./pnl";

export const SWAP_EVENT = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);

/// The RPC accepts 20,000; the hook that reads trades in the browser found 50,000
/// fails despite the node advertising 100,000.
const CHUNK = 20_000n;

/// Bounded so one run cannot outlive a serverless invocation. Whatever is left
/// is picked up next tick.
const MAX_CHUNKS_PER_RUN = 12;
const MAX_POOLS_PER_RUN = 8;

export const K = {
  pools: "idx:pools",
  cursor: (pool: string) => `idx:cur:${pool.toLowerCase()}`,
  position: (w: string, t: string) => `pos:${w.toLowerCase()}:${t.toLowerCase()}`,
  traderTokens: (w: string) => `pos:tokens:${w.toLowerCase()}`,
  tokenTraders: (t: string) => `pos:traders:${t.toLowerCase()}`,
  traders: "pos:traders",
  volume: "lb:volume",
};

const client = () => createPublicClient({ chain, transport: http(RPC_URL) });

/// Addresses that trade but are not traders. The launchpad sells collected token
/// fees for USDC on every collection, which is a real swap with a real profit,
/// and counting it would put the protocol at the top of its own leaderboard.
const NOT_A_TRADER = new Set<string>([LAUNCHPAD_ADDRESS.toLowerCase()]);

export type PoolRef = { pool: string; token: string; createdAt: number };

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
  })) as readonly { token: Address; pool: Address; createdAt: bigint }[];

  const entries = raw.map((l) => ({
    pool: l.pool,
    token: l.token,
    createdAt: Number(l.createdAt),
  }));
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

/// Fold one pool's new swaps into the positions they belong to.
async function indexPool(
  pool: string,
  token: string,
  head: bigint,
  createdAt: number,
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
    const logs = await pub.getLogs({
      address: pool as Address,
      event: SWAP_EVENT,
      fromBlock: from,
      toBlock: to,
    });

    // Group by trader so a busy chunk costs one read and one write per trader,
    // not one per swap.
    const touched = new Map<string, Position>();
    const order: string[] = [];
    for (const log of logs) {
      const a = log.args as { recipient?: Address; amount0?: bigint; amount1?: bigint };
      if (!a.recipient || a.amount0 === undefined || a.amount1 === undefined) continue;
      const who = a.recipient.toLowerCase();
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

    for (const log of logs) {
      const a = log.args as { recipient?: Address; amount0?: bigint; amount1?: bigint };
      if (!a.recipient || a.amount0 === undefined || a.amount1 === undefined) continue;
      const who = a.recipient.toLowerCase();
      if (NOT_A_TRADER.has(who)) continue;
      const cur = touched.get(who) ?? EMPTY;
      // token0 is the launch token, token1 is USDC. Negative means the pool paid
      // it out, so amount0 < 0 is the trader receiving tokens: a buy.
      touched.set(
        who,
        a.amount0 < 0n
          ? applyBuy(cur, a.amount1, -a.amount0)
          : applySell(cur, a.amount0, -a.amount1),
      );
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
      const r = await indexPool(p.pool, p.token, head, p.createdAt);
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
