"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";

import { launchpadAbi, launchTokenAbi, uniswapV3PoolAbi } from "./abi";
import { LAUNCHPAD_ADDRESS, TOKEN_DECIMALS, isDeployed } from "./config";
import {
  marketCapFromSqrtPriceX96,
  marketCapAtTick,
  curveCapacityUsd,
  remainingCapacityUsd,
  fractionSold,
} from "./launch-math";

export type RawLaunch = {
  token: Address;
  pool: Address;
  creator: Address;
  feeRecipient: Address;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  createdAt: bigint;
  creatorAllocation: bigint;
  unlockAt: bigint;
  allocationClaimed: boolean;
  buybackAndBurn: boolean;
  usdcSpentOnBuybacks: bigint;
  tokensBurned: bigint;
};

export type LaunchView = RawLaunch & {
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
export function useLaunches(limit = 60) {
  const registry = useReadContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    functionName: "recentLaunches",
    args: [0n, BigInt(limit)],
    query: { enabled: isDeployed, refetchInterval: 12_000 },
  });

  const raw = (registry.data ?? []) as readonly RawLaunch[];

  const detailCalls = useMemo(
    () =>
      raw.flatMap((l) => [
        { address: l.pool, abi: uniswapV3PoolAbi, functionName: "slot0" } as const,
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
    query: { enabled: raw.length > 0, refetchInterval: 12_000 },
  });

  const launches = useMemo<LaunchView[]>(() => {
    if (!details.data) return [];
    return raw
      .map((l, i) => {
        const base = i * 7;
        const slot0 = details.data[base]?.result as
          | readonly [bigint, number, number, number, number, number, boolean]
          | undefined;
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
    query: { enabled: isDeployed && !!token, refetchInterval: 15_000 },
  });

  const l = entry.data as RawLaunch | undefined;

  const details = useReadContracts({
    contracts: l
      ? [
          { address: l.pool, abi: uniswapV3PoolAbi, functionName: "slot0" } as const,
          { address: l.token, abi: launchTokenAbi, functionName: "name" } as const,
          { address: l.token, abi: launchTokenAbi, functionName: "symbol" } as const,
          { address: l.token, abi: launchTokenAbi, functionName: "totalSupply" } as const,
          { address: l.token, abi: launchTokenAbi, functionName: "metadataURI" } as const,
          { address: l.token, abi: launchTokenAbi, functionName: "rewardsEnabled" } as const,
          { address: l.token, abi: launchTokenAbi, functionName: "totalRewardsReceived" } as const,
        ]
      : [],
    query: { enabled: !!l, refetchInterval: 6_000 },
  });

  const launch = useMemo<LaunchView | null>(() => {
    if (!l || !details.data) return null;
    const slot0 = details.data[0]?.result as
      | readonly [bigint, number, number, number, number, number, boolean]
      | undefined;
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

  return {
    launch,
    isLoading: entry.isLoading || details.isLoading,
    notFound: !!entry.error,
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

  const marketCapUsd = marketCapFromSqrtPriceX96(extra.sqrtPriceX96, supplyWhole);
  const startMarketCapUsd = marketCapAtTick(tickLower, supplyWhole);
  const ceilingMarketCapUsd = marketCapAtTick(tickUpper, supplyWhole);

  // Progress is measured in supply sold, not distance through the tick range:
  // it is what actually tells a buyer how much is left to go around.
  const curveProgress = fractionSold(tickLower, tickUpper, extra.currentTick);
  const remaining = remainingCapacityUsd(tickLower, tickUpper, extra.currentTick, supplyWhole);
  const totalCapacityUsd = curveCapacityUsd(tickLower, tickUpper, supplyWhole);

  return {
    ...l,
    tickLower,
    tickUpper,
    name: extra.name,
    symbol: extra.symbol,
    totalSupply: extra.totalSupply,
    supplyWhole,
    metadataURI: extra.metadataURI,
    currentTick: extra.currentTick,
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
