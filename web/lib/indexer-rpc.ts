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
