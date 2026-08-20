"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits, parseAbiItem, type Address } from "viem";
import { usePublicClient } from "wagmi";

import { TOKEN_DECIMALS, USDC_DECIMALS } from "./config";

export type Trade = {
  id: string;
  side: "buy" | "sell";
  usdc: number;
  tokens: number;
  who: Address;
  blockNumber: bigint;
};

const SWAP_EVENT = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
);

/// Measured against Arc's public RPC: a 20,000-block `eth_getLogs` range
/// succeeds, 50,000 fails with "requested range too large" — despite the node
/// advertising a 100,000 limit in its own error text.
const CHUNK_BLOCKS = 20_000n;

/// Arc blocks are ~0.51s, so one chunk is only ~170 minutes of history. Paging
/// back this many chunks covers roughly 17 hours, which is enough to show a
/// launch's full trading life on a testnet. The walk stops early as soon as
/// `MAX_TRADES` have been found, so busy tokens cost a single request.
const MAX_BACKFILL_CHUNKS = 6;

/// Small gap between backfill requests; the public RPC rate-limits bursts.
const CHUNK_DELAY_MS = 150;

const POLL_MS = 6_000;
const MAX_TRADES = 30;

/// Live trade tape for a pool.
///
/// @dev Deliberately polls `eth_getLogs` rather than using wagmi's
///      `useWatchContractEvent`. That hook installs an `eth_newFilter`
///      subscription, which Arc's public RPC answers with "internal error" — so
///      the watcher fails silently and no trade ever appears. Polling a bounded
///      block range works on every provider and has the side benefit of
///      backfilling history, so the tape is populated on first paint instead of
///      only showing trades that happen while the tab is open.
export function useTrades(pool: Address | undefined) {
  const publicClient = usePublicClient();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const lastScanned = useRef<bigint | null>(null);

  useEffect(() => {
    setTrades([]);
    setIsLoading(true);
    lastScanned.current = null;
  }, [pool]);

  useEffect(() => {
    if (!publicClient || !pool) return;
    let cancelled = false;

    async function fetchRange(from: bigint, to: bigint) {
      return publicClient!.getLogs({
        address: pool,
        event: SWAP_EVENT,
        fromBlock: from,
        toBlock: to,
      });
    }

    async function scan() {
      try {
        const head = await publicClient!.getBlockNumber();
        type RawLog = Awaited<ReturnType<typeof fetchRange>>[number];
        let logs: RawLog[] = [];

        if (lastScanned.current !== null) {
          // Steady state: only the blocks produced since the last poll.
          const from = lastScanned.current + 1n;
          if (from > head) return;
          logs = await fetchRange(from, head);
        } else {
          // First load: walk backwards a chunk at a time until enough trades
          // have been found or the backfill limit is reached.
          let to = head;
          for (let i = 0; i < MAX_BACKFILL_CHUNKS; i++) {
            const from = to > CHUNK_BLOCKS ? to - CHUNK_BLOCKS : 0n;
            const chunk = await fetchRange(from, to);
            logs = [...chunk, ...logs];
            if (logs.length >= MAX_TRADES || from === 0n || cancelled) break;
            to = from - 1n;
            await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
          }
        }

        lastScanned.current = head;

        if (cancelled) return;

        const parsed: Trade[] = logs
          .map((log) => {
            const a = log.args;
            if (a.amount0 === undefined || a.amount1 === undefined || !a.recipient) return null;
            // token0 is always the launch token, token1 always USDC.
            // A negative amount0 means tokens left the pool: someone bought.
            const tokenDelta = Number(formatUnits(a.amount0, TOKEN_DECIMALS));
            const usdcDelta = Number(formatUnits(a.amount1, USDC_DECIMALS));
            return {
              id: `${log.transactionHash}-${log.logIndex}`,
              side: (tokenDelta < 0 ? "buy" : "sell") as "buy" | "sell",
              usdc: Math.abs(usdcDelta),
              tokens: Math.abs(tokenDelta),
              who: a.recipient,
              blockNumber: log.blockNumber ?? 0n,
            };
          })
          .filter((t): t is Trade => t !== null);

        if (parsed.length > 0) {
          setTrades((prev) => {
            const seen = new Set(prev.map((t) => t.id));
            const fresh = parsed.filter((t) => !seen.has(t.id));
            return [...fresh.reverse(), ...prev].slice(0, MAX_TRADES);
          });
        }
      } catch {
        // A transient RPC error should not clear the tape; the next tick retries.
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
  }, [publicClient, pool]);

  return { trades, isLoading };
}
