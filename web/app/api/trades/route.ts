/// The live trade tape, read server-side.
///
/// This used to run in the browser against the wallet's RPC. That endpoint is
/// Alchemy, whose free tier caps `eth_getLogs` at a **10 block** range -- so a
/// 20,000-block backfill was rejected on every single poll, the hook's catch
/// swallowed the error, and every token page said "No trades yet" forever, even
/// on a pool that had just been traded.
///
/// Arc's public RPC accepts 20,000-block ranges, but it must not be called from
/// the browser: it is unauthenticated and rate-limits per IP, so a handful of
/// open tabs would starve each other. Reading it here keeps the wide-range
/// query on the one endpoint that answers it and puts a cache in front.

import { NextResponse } from "next/server";
import { formatUnits, isAddress,
  isHex, parseAbiItem, type Address } from "viem";

import { SWAP_EVENT } from "@/lib/indexer";
import {
  CURVE_ADDRESS,
  LAUNCHPAD_ADDRESS,
  SWAP_ROUTER_ADDRESS,
  TOKEN_DECIMALS,
  USDC_DECIMALS,
} from "@/lib/config";
import { indexerClient } from "@/lib/indexer-rpc";
import { cmd, redisConfigured } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/// Arc's public RPC refuses anything over 10,000 blocks now; it accepted 20,000
/// when this was written. Held a little under the ceiling on purpose.
const CHUNK = 9_000n;

/// ~0.51s blocks, so one chunk is ~170 minutes. Log calls per request are
/// capped well under what trips the public RPCs' burst limit; a backfill that
/// needs more resumes on the next poll (see `Tape`). The walk stops as soon as
/// MAX_TRADES are found, so a busy pool costs one request.
const CHUNKS_PER_REQUEST = 5;

/// How far back a tape is ever built: ~117,000 blocks, roughly 17 hours, which
/// covers a launch's whole trading life on testnet. Without a floor the
/// backfill walks toward block 0 forever -- a pool with three trades would
/// still be scanning millions of empty blocks days later, which is exactly the
/// traffic that gets the public endpoints to throttle us.
const MAX_BACKFILL_CHUNKS = 13;
const MAX_TRADES = 30;

/// Five chunk scans with retries can outlast Vercel's default budget.
export const maxDuration = 30;

/// The launchpad swaps against the pool itself, converting the token-side fees
/// it just collected into USDC. Those are bookkeeping, not trades: they appear
/// as a sell of a few thousandths of a token for $0.00 and would sit in the tape
/// looking like a real trader dumping. The indexer already excludes this address
/// from PNL for the same reason.
const NOT_A_TRADER = new Set([LAUNCHPAD_ADDRESS.toLowerCase(), CURVE_ADDRESS.toLowerCase()]);

/// A trade against a bonding curve, before the launch graduates into its pool.
const CURVE_TRADE_EVENT = parseAbiItem(
  "event Trade(address indexed token, address indexed trader, bool isBuy, uint256 usdcAmount, uint256 tokenAmount, uint256 fee, uint256 tokensSold, uint256 usdcRaised)",
);

type TapeEntry = {
  id: string;
  side: "buy" | "sell";
  usdc: number;
  tokens: number;
  who: Address;
  hash: `0x${string}`;
  blockNumber: number;
  logIndex: number;
};

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const pool = params.get("pool");
  const token = params.get("token");
  // A curve launch passes its token (for curve trades) and, once graduated, its
  // pool as well; the tape shows the curve history leading into the pool's.
  // A v4 pool is identified by the 32-byte hash of its key, not an address.
  const hasPool = !!pool && isHex(pool) && pool.length === 66 && BigInt(pool) !== 0n;
  const hasCurve = !!token && isAddress(token) && BigInt(CURVE_ADDRESS) !== 0n;
  if (!hasPool && !hasCurve) {
    return NextResponse.json({ error: "bad pool" }, { status: 400 });
  }

  const client = indexerClient();
  const cacheKey = `tape:v5:${(pool ?? "").toLowerCase()}:${(token ?? "").toLowerCase()}`;

  try {
    // Typed through helpers rather than inline: `getLogs` only narrows its
    // return to decoded `args` when the event is bound at the call site.
    const poolRange = (from: bigint, to: bigint) =>
      client.getLogs({
        address: SWAP_ROUTER_ADDRESS,
        event: SWAP_EVENT,
        args: { id: pool as `0x${string}` },
        fromBlock: from,
        toBlock: to,
      });
    const curveRange = (from: bigint, to: bigint) =>
      client.getLogs({
        address: CURVE_ADDRESS,
        event: CURVE_TRADE_EVENT,
        args: { token: token as Address },
        fromBlock: from,
        toBlock: to,
      });

    const fromPool = (logs: Awaited<ReturnType<typeof poolRange>>): TapeEntry[] =>
      logs.flatMap((log) => {
        const a = log.args;
        if (a.amountIn === undefined || a.amountOut === undefined || a.zeroForOne === undefined || !a.trader) {
          return [];
        }
        if (NOT_A_TRADER.has(a.trader.toLowerCase())) return [];
        // currency0 is always the launch token and currency1 always USDC, so
        // zeroForOne is somebody selling.
        const buy = !a.zeroForOne;
        const usdcRaw = buy ? a.amountIn : a.amountOut;
        const tokenRaw = buy ? a.amountOut : a.amountIn;
        return [{
          id: `${log.transactionHash}-${log.logIndex}`,
          side: buy ? "buy" : "sell",
          usdc: Number(formatUnits(usdcRaw, USDC_DECIMALS)),
          tokens: Number(formatUnits(tokenRaw, TOKEN_DECIMALS)),
          who: a.trader,
          hash: log.transactionHash,
          blockNumber: Number(log.blockNumber ?? 0n),
          logIndex: log.logIndex ?? 0,
        }];
      });

    const fromCurve = (logs: Awaited<ReturnType<typeof curveRange>>): TapeEntry[] =>
      logs.flatMap((log) => {
        const a = log.args;
        if (a.usdcAmount === undefined || a.tokenAmount === undefined || !a.trader) return [];
        return [{
          id: `${log.transactionHash}-${log.logIndex}`,
          side: a.isBuy ? "buy" : "sell",
          usdc: Number(formatUnits(a.usdcAmount, USDC_DECIMALS)),
          tokens: Number(formatUnits(a.tokenAmount, TOKEN_DECIMALS)),
          who: a.trader,
          hash: log.transactionHash,
          blockNumber: Number(log.blockNumber ?? 0n),
          logIndex: log.logIndex ?? 0,
        }];
      });

    const head = await client.getBlockNumber();

    // Whatever the last request left behind: the tape as of `head`, and how far
    // back its backfill has reached. Every poll then scans only the blocks
    // since -- one call per event type instead of a fresh walk over ~117,000
    // blocks. That walk, repeated every six seconds by every open tab, is what
    // got the public RPCs to throttle us. The backfill itself is resumable for
    // the same reason: a burst of thirteen calls trips the limit, so each
    // request does a few chunks, saves where it stopped, and the next carries on.
    const prior = await loadTape(cacheKey);
    const tape: Tape = prior ?? {
      head: Number(head),
      low: Number(head) + 1,
      floor: Number(head > CHUNK * BigInt(MAX_BACKFILL_CHUNKS) ? head - CHUNK * BigInt(MAX_BACKFILL_CHUNKS) : 0n),
      done: false,
      entries: [],
    };
    let budget = CHUNKS_PER_REQUEST;
    let failure: unknown = null;

    const scan = async (lo: bigint, hi: bigint): Promise<TapeEntry[]> => {
      const [p, c] = await Promise.all([
        hasPool ? poolRange(lo, hi).then(fromPool) : Promise.resolve([]),
        hasCurve ? curveRange(lo, hi).then(fromCurve) : Promise.resolve([]),
      ]);
      return [...p, ...c];
    };
    const absorb = (found: TapeEntry[]) => {
      const seen = new Set(tape.entries.map((e) => e.id));
      tape.entries = [...found.filter((e) => !seen.has(e.id)), ...tape.entries]
        .sort((x, y) => y.blockNumber - x.blockNumber || y.logIndex - x.logIndex)
        .slice(0, MAX_TRADES);
    };

    try {
      // Catch up: from the last head seen up to now, bottom-up so that `head`
      // only ever advances over blocks that were actually read.
      if (prior) {
        let from = BigInt(prior.head) + 1n;
        while (from <= head && budget > 0) {
          const to = from + CHUNK - 1n < head ? from + CHUNK - 1n : head;
          absorb(await scan(from, to));
          tape.head = Number(to);
          from = to + 1n;
          budget--;
        }
      }
      // Backfill: from the lowest block already read, downward, until the tape
      // is full or the chain begins.
      while (!tape.done && budget > 0) {
        const hi = BigInt(tape.low) - 1n;
        if (hi < BigInt(tape.floor)) { tape.done = true; break; }
        const floor = BigInt(tape.floor);
        const lo = hi >= floor + CHUNK ? hi - CHUNK + 1n : floor;
        absorb(await scan(lo, hi));
        tape.low = Number(lo);
        budget--;
        if (tape.entries.length >= MAX_TRADES || lo <= floor) tape.done = true;
      }
    } catch (e) {
      // Every RPC in the list refused. Keep what was read -- the next request
      // resumes from exactly here -- and show it, a beat behind.
      failure = e;
    }
    await saveTape(cacheKey, tape);

    if (failure && tape.entries.length === 0 && !tape.done) throw failure;

    const trades = tape.entries.map(({ logIndex: _, ...rest }) => rest);

    return NextResponse.json(
      { trades, complete: tape.done },
      // Shared cache so many viewers of a hot token collapse into one upstream
      // read; stale-while-revalidate keeps the tape instant on repeat paints.
      { headers: { "cache-control": "public, s-maxage=5, stale-while-revalidate=25" } },
    );
  } catch (e) {
    // A transient RPC failure must not read as "this pool has never traded",
    // so the shape here is distinguishable from an empty tape.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "rpc failed" },
      { status: 502 },
    );
  }
}

/// `head` is the newest block read, `low` the oldest, `floor` the oldest it
/// will ever read; `done` says the backfill reached MAX_TRADES or that floor,
/// after which a poll only scans the handful of blocks since `head`.
type Tape = { head: number; low: number; floor: number; done: boolean; entries: TapeEntry[] };

/// A day is plenty: a tape nobody has looked at for that long is rebuilt from
/// a fresh backfill, which is what it would have been served anyway.
const TAPE_TTL_S = 86_400;

async function loadTape(key: string): Promise<Tape | null> {
  if (!redisConfigured) return null;
  try {
    const raw = await cmd<string | null>("GET", key);
    return raw ? (JSON.parse(raw) as Tape) : null;
  } catch {
    return null; // a cache miss, never a failed request
  }
}

async function saveTape(key: string, tape: Tape): Promise<void> {
  if (!redisConfigured) return;
  try {
    await cmd("SET", key, JSON.stringify(tape), "EX", String(TAPE_TTL_S));
  } catch {
    // Next request scans again; nothing shown is wrong.
  }
}
