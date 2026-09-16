/// The transport every server-side log scan goes through.
///
/// viem's `fallback` tries the endpoints in order and moves to the next one
/// when a request errors -- a rate limit, a refused range, an outage -- which
/// is exactly the failure a single public RPC produces a few times a day.
/// Ranking is off so the order in INDEXER_RPC_URLS is the order used: the
/// configured endpoint first, the chain's public ones behind it.
import { createPublicClient, fallback, http } from "viem";

import { INDEXER_RPC_URLS, chain } from "./config";

export const indexerTransport = () =>
  fallback(INDEXER_RPC_URLS.map((url) => http(url, { retryCount: 2, retryDelay: 400, timeout: 8_000 })), { rank: false });

export const indexerClient = () => createPublicClient({ chain, transport: indexerTransport() });

/// A refusal that means "too many results for one query", not "slow down".
///
/// Arc mainnet's public RPC caps a query at 2,000 logs ("query exceeds max
/// results 2000"), Alchemy by response size ("Log response size exceeded"), and
/// viem itself refuses a body over its own limit ("HTTP response body exceeded
/// the size limit"). All three mean the same thing and are fixed the same way.
/// Testnet never came close. Rate limits are deliberately excluded: halving a
/// range doubles the requests, which is the opposite of what a rate limit asks.
const TOO_MANY_RESULTS = /max results|response size|response body exceeded|max allowed range|too many (results|logs)|query returned more than|block range (is )?too (large|wide)/i;

function isTooManyResults(e: unknown): boolean {
  const err = e as { name?: string; details?: string; shortMessage?: string; message?: string; cause?: unknown };
  const cause = err?.cause as { name?: string; message?: string } | undefined;
  if (err?.name === "ResponseBodyTooLargeError" || cause?.name === "ResponseBodyTooLargeError") return true;
  const text = [err?.details, err?.shortMessage, err?.message, cause?.message]
    .filter(Boolean)
    .join(" ");
  return TOO_MANY_RESULTS.test(text) && !/rate limit/i.test(text);
}

/// Scan `[from, to]`, splitting the range in half whenever the RPC says it holds
/// too many results, until every piece fits.
///
/// Without this a hot token -- more than 2,000 trades in one ~76-minute chunk --
/// could never be read: its trade tape errored and its indexer cursor could not
/// advance, so the leaderboard froze on precisely the token everyone was
/// watching. Order is preserved, so callers see logs exactly as a single query
/// would have returned them.
export async function getLogsSplit<T>(
  fetch: (from: bigint, to: bigint) => Promise<T[]>,
  from: bigint,
  to: bigint,
  depth = 0,
): Promise<T[]> {
  try {
    return await fetch(from, to);
  } catch (e) {
    // Twenty halvings takes 9,000 blocks down to a single block; past that the
    // refusal is not about range and splitting further cannot help.
    if (to <= from || depth >= 20 || !isTooManyResults(e)) throw e;
    const mid = from + (to - from) / 2n;
    const left = await getLogsSplit(fetch, from, mid, depth + 1);
    const right = await getLogsSplit(fetch, mid + 1n, to, depth + 1);
    return [...left, ...right];
  }
}
