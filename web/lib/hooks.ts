"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import type { Address, Hex } from "viem";

import { launchpadAbi, launchTokenAbi, stateViewAbi } from "./abi";
import { poolIdFor } from "./v4";
import { LAUNCHPAD_ADDRESS, STATE_VIEW_ADDRESS, TOKEN_DECIMALS, isDeployed } from "./config";
import type { CurveState } from "./curve";
import {
  tickToHumanPrice,
  marketCapFromSqrtPriceX96,
  marketCapAtTick,
  curveCapacityUsd,
  remainingCapacityUsd,
  fractionSold,
} from "./launch-math";

export type RawLaunch = {
  token: Address;
  pool: Hex;
  creator: Address;
  feeRecipient: Address;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  createdAt: bigint;
  creatorAllocation: bigint;
  buybackAndBurn: boolean;
  usdcSpentOnBuybacks: bigint;
  tokensBurned: bigint;
};

export type LaunchView = RawLaunch & {
  /// "direct" opened straight into a Uniswap pool; "curve" started on the
  /// bonding curve and carries its state in `curve`.
  kind: "direct" | "curve";
  /// Dollars per whole token, whichever market the token trades in.
  priceUsd: number;
  curve?: CurveState;
  name: string;
  symbol: string;
  totalSupply: bigint;
  supplyWhole: bigint;
  metadataURI: string;
  currentTick: number;
  sqrtPriceX96: bigint;
  marketCapUsd: number;
  startMarketCapUsd: number;
  ceilingMarketCapUsd: number;
  /// Fraction of the launch supply already bought out of the pool, 0..1.
  curveProgress: number;
  /// USDC the range can still absorb before every token is sold.
  remainingCapacityUsd: number;
  /// USDC the range could absorb in total, measured at launch.
  totalCapacityUsd: number;
  /// Whether swap fees are shared with holders instead of kept by the creator.
  rewardsEnabled: boolean;
  /// Lifetime USDC paid to holders, in base units.
  totalRewardsReceived: bigint;
};

/// Reads the launch registry, then enriches each entry with live pool state and
/// token metadata. Batched through multicall3, which Arc has deployed.
///
/// Intervals here are deliberately slack. At 60 entries this fans out to 420
/// reads per poll, which earned a -32005 "rate limit exceeded" from the public
/// Arc RPC -- and a rate-limited read used to surface as "not a launch from
/// this pad", so throttling is a correctness matter, not just politeness.
export function useLaunches(limit = 30) {
  const registry = useReadContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    functionName: "recentLaunches",
    args: [0n, BigInt(limit)],
    query: { enabled: isDeployed, refetchInterval: 20_000 },
  });

  const raw = (registry.data ?? []) as readonly RawLaunch[];

  const detailCalls = useMemo(
    () =>
      raw.flatMap((l) => [
        { address: STATE_VIEW_ADDRESS, abi: stateViewAbi, functionName: "getSlot0", args: [poolIdFor(l.token)] } as const,
        { address: l.token, abi: launchTokenAbi, functionName: "name" } as const,
        { address: l.token, abi: launchTokenAbi, functionName: "symbol" } as const,
        { address: l.token, abi: launchTokenAbi, functionName: "totalSupply" } as const,
        { address: l.token, abi: launchTokenAbi, functionName: "metadataURI" } as const,
        { address: l.token, abi: launchTokenAbi, functionName: "rewardsEnabled" } as const,
        { address: l.token, abi: launchTokenAbi, functionName: "totalRewardsReceived" } as const,
      ]),
    [raw],
  );

  const details = useReadContracts({
    contracts: detailCalls,
    query: { enabled: raw.length > 0, refetchInterval: 20_000 },
  });

  const launches = useMemo<LaunchView[]>(() => {
    if (!details.data) return [];
    return raw
      .map((l, i) => {
        const base = i * 7;
        // v4's getSlot0: (sqrtPriceX96, tick, protocolFee, lpFee)
        const slot0 = details.data[base]?.result as readonly [bigint, number, number, number] | undefined;
        const name = details.data[base + 1]?.result as string | undefined;
        const symbol = details.data[base + 2]?.result as string | undefined;
        const totalSupply = details.data[base + 3]?.result as bigint | undefined;
        const metadataURI = (details.data[base + 4]?.result as string | undefined) ?? "";
        const rewardsEnabled = (details.data[base + 5]?.result as boolean | undefined) ?? false;
        const totalRewardsReceived = (details.data[base + 6]?.result as bigint | undefined) ?? 0n;

        if (!slot0 || !totalSupply || name === undefined || symbol === undefined) return null;

        return buildLaunchView(l, {
          sqrtPriceX96: slot0[0],
          currentTick: slot0[1],
          name,
          symbol,
          totalSupply,
          metadataURI,
          rewardsEnabled,
          totalRewardsReceived,
        });
      })
      .filter((l): l is LaunchView => l !== null);
  }, [raw, details.data]);

  return {
    launches,
    isLoading: registry.isLoading || (raw.length > 0 && details.isLoading),
    error: registry.error ?? details.error,
    refetch: () => {
      void registry.refetch();
      void details.refetch();
    },
  };
}

/// Single launch, for the token detail page.
export function useLaunch(token: Address | undefined) {
  const entry = useReadContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    functionName: "launchOf",
    args: token ? [token] : undefined,
    query: { enabled: isDeployed && !!token, refetchInterval: 20_000 },
  });

  const l = entry.data as RawLaunch | undefined;

  const details = useReadContracts({
    contracts: l
      ? [
          { address: STATE_VIEW_ADDRESS, abi: stateViewAbi, functionName: "getSlot0", args: [poolIdFor(l.token)] } as const,
          { address: l.token, abi: launchTokenAbi, functionName: "name" } as const,
          { address: l.token, abi: launchTokenAbi, functionName: "symbol" } as const,
          { address: l.token, abi: launchTokenAbi, functionName: "totalSupply" } as const,
          { address: l.token, abi: launchTokenAbi, functionName: "metadataURI" } as const,
          { address: l.token, abi: launchTokenAbi, functionName: "rewardsEnabled" } as const,
          { address: l.token, abi: launchTokenAbi, functionName: "totalRewardsReceived" } as const,
        ]
      : [],
    query: { enabled: !!l, refetchInterval: 15_000 },
  });

  const launch = useMemo<LaunchView | null>(() => {
    if (!l || !details.data) return null;
    const slot0 = details.data[0]?.result as readonly [bigint, number, number, number] | undefined;
    const name = details.data[1]?.result as string | undefined;
    const symbol = details.data[2]?.result as string | undefined;
    const totalSupply = details.data[3]?.result as bigint | undefined;
    const metadataURI = (details.data[4]?.result as string | undefined) ?? "";
    const rewardsEnabled = (details.data[5]?.result as boolean | undefined) ?? false;
    const totalRewardsReceived = (details.data[6]?.result as bigint | undefined) ?? 0n;
    if (!slot0 || !totalSupply || name === undefined || symbol === undefined) return null;

    return buildLaunchView(l, {
      sqrtPriceX96: slot0[0],
      currentTick: slot0[1],
      name,
      symbol,
      totalSupply,
      metadataURI,
      rewardsEnabled,
      totalRewardsReceived,
    });
  }, [l, details.data]);

  // launchOf returns a zero-filled struct for a token this pad did not create.
  // That -- not an RPC failure -- is what "not a launch" means. Treating a
  // failed read as proof of absence told people their own token did not exist.
  const ZERO = "0x0000000000000000000000000000000000000000";
  const notFound = !!l && (l.token === ZERO || l.pool === ZERO);

  return {
    launch,
    isLoading: entry.isLoading || details.isLoading,
    notFound,
    error: entry.error ?? details.error ?? null,
  };
}

function buildLaunchView(
  l: RawLaunch,
  extra: {
    sqrtPriceX96: bigint;
    currentTick: number;
    name: string;
    symbol: string;
    totalSupply: bigint;
    metadataURI: string;
    rewardsEnabled: boolean;
    totalRewardsReceived: bigint;
  },
): LaunchView {
  const supplyWhole = extra.totalSupply / 10n ** BigInt(TOKEN_DECIMALS);
  const tickLower = Number(l.tickLower);
  const tickUpper = Number(l.tickUpper);

  // A sell that takes the last USDC out of the pool leaves the pool's own
  // price marker *below* the range floor -- the swap runs on to its price
  // limit through empty liquidity -- and a range bought out to the top leaves
  // it above the ceiling. Neither is a price anyone can trade at: the next buy
  // fills from the floor, the next sell from the ceiling. Everything shown is
  // therefore derived from the tick clamped to the range, so a launch whose
  // pool was emptied reads as its $2.5K floor rather than $0.
  const currentTick = Math.min(Math.max(extra.currentTick, tickLower), tickUpper);
  const inRange = currentTick === extra.currentTick;

  const marketCapUsd = inRange
    ? marketCapFromSqrtPriceX96(extra.sqrtPriceX96, supplyWhole)
    : marketCapAtTick(currentTick, supplyWhole);
  const startMarketCapUsd = marketCapAtTick(tickLower, supplyWhole);
  const ceilingMarketCapUsd = marketCapAtTick(tickUpper, supplyWhole);

  // Progress is measured in supply sold, not distance through the tick range:
  // it is what actually tells a buyer how much is left to go around.
  const curveProgress = fractionSold(tickLower, tickUpper, currentTick);
  const remaining = remainingCapacityUsd(tickLower, tickUpper, currentTick, supplyWhole);
  const totalCapacityUsd = curveCapacityUsd(tickLower, tickUpper, supplyWhole);

  return {
    ...l,
    kind: "direct",
    priceUsd: tickToHumanPrice(currentTick),
    tickLower,
    tickUpper,
    name: extra.name,
    symbol: extra.symbol,
    totalSupply: extra.totalSupply,
    supplyWhole,
    metadataURI: extra.metadataURI,
    currentTick,
    sqrtPriceX96: extra.sqrtPriceX96,
    marketCapUsd,
    startMarketCapUsd,
    ceilingMarketCapUsd,
    curveProgress,
    remainingCapacityUsd: remaining,
    totalCapacityUsd,
    rewardsEnabled: extra.rewardsEnabled,
    totalRewardsReceived: extra.totalRewardsReceived,
  };
}
