"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";

export type Trade = {
  id: string;
  side: "buy" | "sell";
  usdc: number;
  tokens: number;
  who: Address;
  hash: `0x${string}`;
  blockNumber: number;
};

const POLL_MS = 6_000;

/// Live trade tape for a pool.
///
/// @dev The log scan lives in `/api/trades`, not here. Two reasons it cannot run
///      in the browser:
///
///      1. The browser's RPC is Alchemy, whose free tier caps `eth_getLogs` at a
///         **10 block** range. The backfill asks for 20,000, so every request was
///         rejected and the tape was permanently empty -- silently, because the
///         error was caught to stop transient failures from clearing the list.
///      2. Arc's public RPC does accept 20,000-block ranges but is
///         unauthenticated and rate-limited per IP, so it cannot be exposed to
///         every open tab.
///
///      Polling a JSON route also avoids `eth_newFilter`, which Arc answers with
///      "internal error" -- the reason wagmi's `useWatchContractEvent` never
///      produced a single trade here.
export function useTrades(pool: Address | undefined) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Clearing the tape when the pool changes is done during render rather than in
  // an effect. An effect would paint one frame of the previous token's trades
  // under the new token's name before the reset landed.
  const [seenPool, setSeenPool] = useState(pool);
  if (pool !== seenPool) {
    setSeenPool(pool);
    setTrades([]);
    setIsLoading(true);
  }

  useEffect(() => {
    if (!pool) return;
    let cancelled = false;

    async function scan() {
      try {
        const res = await fetch(`/api/trades?pool=${pool}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { trades?: Trade[] };
        if (cancelled || !Array.isArray(body.trades)) return;
        setTrades(body.trades);
      } catch {
        // Keep whatever is already on screen; the next tick retries.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void scan();
    const timer = setInterval(() => void scan(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pool]);

  return { trades, isLoading };
}
