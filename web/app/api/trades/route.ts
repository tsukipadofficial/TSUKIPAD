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
import { createPublicClient, http, formatUnits, isAddress, type Address } from "viem";

import { SWAP_EVENT } from "@/lib/indexer";
import {
  INDEXER_RPC_URL,
  LAUNCHPAD_ADDRESS,
  TOKEN_DECIMALS,
  USDC_DECIMALS,
  chain,
} from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/// Arc's public RPC accepts 20,000 and rejects 50,000, despite its own error
/// text advertising 100,000.
const CHUNK = 20_000n;

/// ~0.51s blocks, so one chunk is ~170 minutes. Six of them reach back roughly
/// 17 hours -- enough to show a launch's whole trading life on testnet. The walk
/// stops as soon as MAX_TRADES are found, so a busy pool costs one request.
const MAX_CHUNKS = 6;
const MAX_TRADES = 30;

/// The launchpad swaps against the pool itself, converting the token-side fees
/// it just collected into USDC. Those are bookkeeping, not trades: they appear
/// as a sell of a few thousandths of a token for $0.00 and would sit in the tape
/// looking like a real trader dumping. The indexer already excludes this address
/// from PNL for the same reason.
const NOT_A_TRADER = new Set([LAUNCHPAD_ADDRESS.toLowerCase()]);

export async function GET(req: Request) {
  const pool = new URL(req.url).searchParams.get("pool");
  if (!pool || !isAddress(pool)) {
    return NextResponse.json({ error: "bad pool" }, { status: 400 });
  }

  const client = createPublicClient({ chain, transport: http(INDEXER_RPC_URL) });

  try {
    // Typed through a helper rather than inline: `getLogs` only narrows its
    // return to decoded `args` when the event is bound at the call site.
    const fetchRange = (from: bigint, to: bigint) =>
      client.getLogs({
        address: pool as Address,
        event: SWAP_EVENT,
        fromBlock: from,
        toBlock: to,
      });

    const head = await client.getBlockNumber();
    type Log = Awaited<ReturnType<typeof fetchRange>>[number];
    let logs: Log[] = [];
    let to = head;

    for (let i = 0; i < MAX_CHUNKS; i++) {
      const from = to > CHUNK ? to - CHUNK : 0n;
      const chunk = await fetchRange(from, to);
      logs = [...chunk, ...logs];
      if (logs.length >= MAX_TRADES || from === 0n) break;
      to = from - 1n;
    }

    const trades = logs
      .map((log) => {
        const a = log.args;
        if (a.amount0 === undefined || a.amount1 === undefined || !a.recipient) return null;
        if (NOT_A_TRADER.has(a.recipient.toLowerCase())) return null;
        // token0 is always the launch token, token1 always USDC. A negative
        // amount0 means tokens left the pool: somebody bought.
        const tokenDelta = Number(formatUnits(a.amount0, TOKEN_DECIMALS));
        const usdcDelta = Number(formatUnits(a.amount1, USDC_DECIMALS));
        return {
          id: `${log.transactionHash}-${log.logIndex}`,
          side: tokenDelta < 0 ? "buy" : "sell",
          usdc: Math.abs(usdcDelta),
          tokens: Math.abs(tokenDelta),
          who: a.recipient,
          hash: log.transactionHash,
          blockNumber: Number(log.blockNumber ?? 0n),
        };
      })
      .filter((t) => t !== null)
      .reverse()
      .slice(0, MAX_TRADES);

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
