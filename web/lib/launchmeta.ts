/// Server-side launch metadata: what a token is called and what it is worth.
///
/// The PNL APIs used to return bare token addresses, so a trader's book read as
/// a column of `0x2165…1A1d` and nobody could tell which position was which.
/// Everything needed to render a row -- name, symbol, image, live price, market
/// cap -- comes from one multicall here rather than from each page separately.

import { createPublicClient, http, type Address } from "viem";

import { launchpadAbi, launchTokenAbi, stateViewAbi } from "./abi";
import { poolIdFor } from "./v4";
import { LAUNCHPAD_ADDRESS, STATE_VIEW_ADDRESS, INDEXER_RPC_URL, chain } from "./config";
import { priceX18FromSqrt, marketCapFromSqrtPriceX96 } from "./launch-math";
import { decodeMetadata, safeImageUrl } from "./metadata";

export type LaunchMeta = {
  token: string;
  name: string;
  symbol: string;
  image?: string;
  /// Total supply in base units (18dp), not whole tokens.
  supply: bigint;
  /// USDC per whole token, scaled 1e18.
  priceX18: bigint;
  marketCapUsd: number;
};

/// Every request that ranks traders needs the same table, and a leaderboard
/// refreshes every 30s per open tab. Without this a busy day would spend its
/// entire RPC budget re-reading names that change never.
const TTL_MS = 15_000;
let cache: { at: number; map: Map<string, LaunchMeta> } | null = null;
let inflight: Promise<Map<string, LaunchMeta>> | null = null;

async function load(): Promise<Map<string, LaunchMeta>> {
  const pub = createPublicClient({ chain, transport: http(INDEXER_RPC_URL) });

  const launches = (await pub.readContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    functionName: "recentLaunches",
    args: [0n, 200n],
  })) as readonly { token: Address }[];

  const out = new Map<string, LaunchMeta>();
  if (launches.length === 0) return out;

  const calls = launches.flatMap((l) => [
    { address: STATE_VIEW_ADDRESS, abi: stateViewAbi, functionName: "getSlot0", args: [poolIdFor(l.token)] },
    { address: l.token, abi: launchTokenAbi, functionName: "name" },
    { address: l.token, abi: launchTokenAbi, functionName: "symbol" },
    { address: l.token, abi: launchTokenAbi, functionName: "totalSupply" },
    { address: l.token, abi: launchTokenAbi, functionName: "metadataURI" },
  ]);

  const res = (await pub.multicall({
    contracts: calls as never,
    allowFailure: true,
  })) as { status: string; result?: unknown }[];

  launches.forEach((l, i) => {
    const b = i * 5;
    if (res[b]?.status !== "success") return;
    const sqrt = (res[b].result as readonly [bigint, ...unknown[]])[0];
    const supply = (res[b + 3]?.result as bigint | undefined) ?? 0n;
    if (supply === 0n) return;

    const meta = decodeMetadata((res[b + 4]?.result as string | undefined) ?? "");
    out.set(l.token.toLowerCase(), {
      token: l.token,
      name: (res[b + 1]?.result as string | undefined) ?? "",
      symbol: (res[b + 2]?.result as string | undefined) ?? "",
      image: safeImageUrl(meta.image),
      supply,
      priceX18: priceX18FromSqrt(sqrt),
      // marketCapFromSqrtPriceX96 counts in WHOLE tokens. Passing base units
      // here reported a $3.2K launch as $3.2 sextillion.
      marketCapUsd: marketCapFromSqrtPriceX96(sqrt, supply / 10n ** 18n),
    });
  });

  return out;
}

export async function launchMeta(): Promise<Map<string, LaunchMeta>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  // Collapse concurrent misses into one upstream read; several tabs refreshing
  // together must not become several identical multicalls.
  if (!inflight) {
    inflight = load()
      .then((map) => {
        cache = { at: Date.now(), map };
        return map;
      })
      .finally(() => {
        inflight = null;
      });
  }
  try {
    return await inflight;
  } catch {
    // Serve the last good table rather than blanking every name on a hiccup.
    return cache?.map ?? new Map();
  }
}

/// Market cap implied by a price, used to show an entry as "$3.1M MC" rather
/// than as a price with five leading zeros -- the way this market actually
/// talks about entries.
export function mcapFromPriceX18(priceX18: bigint, supply: bigint): number {
  if (supply === 0n) return 0;
  return (Number(priceX18) / 1e18) * (Number(supply) / 1e18);
}
