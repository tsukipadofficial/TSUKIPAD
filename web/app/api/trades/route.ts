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
import { createPublicClient, http, formatUnits, isAddress, parseAbiItem, type Address } from "viem";

import { SWAP_EVENT } from "@/lib/indexer";
import {
  CURVE_ADDRESS,
  INDEXER_RPC_URL,
  LAUNCHPAD_ADDRESS,
  SWAP_ROUTER_ADDRESS,
  TOKEN_DECIMALS,
  USDC_DECIMALS,
  chain,
} from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/// Arc's public RPC refuses anything over 10,000 blocks now; it accepted 20,000
/// when this was written. Held a little under the ceiling on purpose.
const CHUNK = 9_000n;

/// ~0.51s blocks, so one chunk is ~170 minutes. Six of them reach back roughly
/// 17 hours -- enough to show a launch's whole trading life on testnet. The walk
/// stops as soon as MAX_TRADES are found, so a busy pool costs one request.
const MAX_CHUNKS = 13;
const MAX_TRADES = 30;

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
  const hasPool = !!pool && isAddress(pool) && BigInt(pool) !== 0n;
  const hasCurve = !!token && isAddress(token) && BigInt(CURVE_ADDRESS) !== 0n;
  if (!hasPool && !hasCurve) {
    return NextResponse.json({ error: "bad pool" }, { status: 400 });
  }

  const client = createPublicClient({ chain, transport: http(INDEXER_RPC_URL) });

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
    let entries: TapeEntry[] = [];
    let to = head;

    for (let i = 0; i < MAX_CHUNKS; i++) {
      const from = to > CHUNK ? to - CHUNK : 0n;
      const [p, c] = await Promise.all([
        hasPool ? poolRange(from, to).then(fromPool) : Promise.resolve([]),
        hasCurve ? curveRange(from, to).then(fromCurve) : Promise.resolve([]),
      ]);
      entries = [...p, ...c, ...entries];
      if (entries.length >= MAX_TRADES || from === 0n) break;
      to = from - 1n;
    }

    const trades = entries
      .sort((x, y) => y.blockNumber - x.blockNumber || y.logIndex - x.logIndex)
      .slice(0, MAX_TRADES)
      .map(({ logIndex: _, ...rest }) => rest);

    return NextResponse.json(
      { trades },
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
