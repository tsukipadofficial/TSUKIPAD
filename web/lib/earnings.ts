/// Lifetime fee earnings per wallet -- the "top earners" board.
///
/// This is a different question from PNL. PNL asks who traded well; earnings ask
/// who was *paid* by the protocol: launch creators taking their fee share,
/// referrers taking theirs, and anyone who claimed an earmark.
///
/// The source is deliberately USDC `Transfer` logs where `from` is the
/// launchpad, not the `FeesCollected` event. FeesCollected reports amounts but
/// not recipients, and the recipient is exactly what a leaderboard needs.
/// Transfers also capture every payout path in one stream -- direct collections,
/// escrow releases on claim, and referral payments -- so a new payout route
/// cannot quietly go unranked.

import { createPublicClient, http, parseAbiItem, type Address } from "viem";

import { launchpadAbi } from "./abi";
import { LAUNCHPAD_ADDRESS, USDC_ADDRESS, INDEXER_RPC_URL, chain } from "./config";
import { cmd, pipeline } from "./redis";

export const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const CHUNK = 20_000n;
const MAX_CHUNKS_PER_RUN = 12;

export const EK = {
  cursor: "earn:cursor",
  total: (w: string) => `earn:total:${w.toLowerCase()}`,
  board: "earn:board",
};

const client = () => createPublicClient({ chain, transport: http(INDEXER_RPC_URL) });

/// The treasury is paid on every single collection, so it would sit permanently
/// at rank one on a board meant to celebrate creators. It is still readable on
/// chain; it is just not a competitor in its own contest.
///
/// Read from the contract rather than an env var. The address is immutable on
/// chain now, but a launchpad redeploy changes it, and a stale constant here
/// would silently start ranking the protocol on its own board again.
let treasuryCache: string | null = null;
async function notAnEarner(): Promise<Set<string>> {
  if (!treasuryCache) {
    try {
      const t = (await client().readContract({
        address: LAUNCHPAD_ADDRESS,
        abi: launchpadAbi,
        functionName: "treasury",
      })) as Address;
      treasuryCache = t.toLowerCase();
    } catch {
      // Better to rank the treasury for one run than to drop every payout.
      return new Set([LAUNCHPAD_ADDRESS.toLowerCase()]);
    }
  }
  return new Set([LAUNCHPAD_ADDRESS.toLowerCase(), treasuryCache]);
}

/// Fold new launchpad payouts into per-wallet lifetime totals.
export async function runEarnings(): Promise<{
  from: string; to: string; payouts: number; caughtUp: boolean;
}> {
  const pub = client();
  const head = await pub.getBlockNumber();

  const stored = await cmd<string | null>("GET", EK.cursor);
  // First run walks back one chunk rather than the whole chain; the launchpad is
  // young and a full history scan would blow the request budget on every cold
  // start. Older payouts are picked up by the backfill below on later runs.
  let from = stored ? BigInt(stored) + 1n : head > CHUNK * 12n ? head - CHUNK * 12n : 0n;

  const skip = await notAnEarner();
  let payouts = 0;
  let chunks = 0;

  while (from <= head && chunks < MAX_CHUNKS_PER_RUN) {
    const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;

    const logs = await pub.getLogs({
      address: USDC_ADDRESS as Address,
      event: TRANSFER_EVENT,
      args: { from: LAUNCHPAD_ADDRESS as Address },
      fromBlock: from,
      toBlock: to,
    });

    const gained = new Map<string, bigint>();
    for (const log of logs) {
      const a = log.args;
      if (!a.to || a.value === undefined || a.value === 0n) continue;
      const who = a.to.toLowerCase();
      if (skip.has(who)) continue;
      gained.set(who, (gained.get(who) ?? 0n) + a.value);
      payouts++;
    }

    if (gained.size > 0) {
      const wallets = [...gained.keys()];
      const prior = await pipeline<string | null>(wallets.map((w) => ["GET", EK.total(w)]));
      const writes: (string | number)[][] = [];
      wallets.forEach((w, i) => {
        const next = (prior[i] ? BigInt(prior[i] as string) : 0n) + gained.get(w)!;
        writes.push(["SET", EK.total(w), next.toString()]);
        // Stored as a plain number of dollars so the board can ZRANGE straight
        // into a ranking without reading every member back.
        writes.push(["ZADD", EK.board, Number(next) / 1e6, w]);
      });
      await pipeline(writes);
    }

    // Advance only over a chunk that fully succeeded -- a throw here leaves the
    // cursor where it was, so the next run repeats this range rather than
    // skipping it. Re-reading is safe: totals are recomputed from a stored base
    // plus this chunk, but a repeated chunk WOULD double-count, so the cursor
    // write must stay inside the loop and after the write above.
    await cmd("SET", EK.cursor, to.toString());
    from = to + 1n;
    chunks++;
  }

  return { from: from.toString(), to: head.toString(), payouts, caughtUp: from > head };
}

export type EarnerRow = { wallet: string; earned: number };

/// Top earners, highest first.
export async function topEarners(limit = 50): Promise<EarnerRow[]> {
  const raw =
    (await cmd<string[]>("ZRANGE", EK.board, 0, limit - 1, "REV", "WITHSCORES")) ?? [];
  const rows: EarnerRow[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    rows.push({ wallet: raw[i], earned: Number(raw[i + 1]) });
  }
  return rows;
}
