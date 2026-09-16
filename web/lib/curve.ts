"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { zeroAddress, type Address, type Hex } from "viem";

import { curveAbi, launchTokenAbi, stateViewAbi } from "./abi";
import { poolIdFor } from "./v4";
import { CURVE_ADDRESS, STATE_VIEW_ADDRESS, TOKEN_DECIMALS, USDC_DECIMALS, isCurveDeployed } from "./config";
import { marketCapFromSqrtPriceX96 } from "./launch-math";
import type { LaunchView } from "./hooks";

/// The curve's shape, fixed at deployment. Every curve launch shares it.
export type CurveConfig = {
  totalSupply: bigint;
  curveSupply: bigint;
  lpSupply: bigint;
  virtualUsdc: bigint;
  virtualTokens: bigint;
  graduationUsdc: bigint;
  tradeFeeBps: number;
  protocolFeeBps: number;
  launchFee: bigint;
  maxCreatorTaxBps: number;
  maxSnipeExempt: number;
  snipeWindow: number;
};

export type RawCurve = {
  token: Address;
  creator: Address;
  feeRecipient: Address;
  pool: Hex;
  createdAt: bigint;
  graduated: boolean;
  creatorTaxBps: number;
  liquidity: bigint;
  tokensSold: bigint;
  usdcRaised: bigint;
};

export type CurveState = {
  tokensSold: bigint;
  usdcRaised: bigint;
  graduated: boolean;
  creatorTaxBps: number;
  curveSupply: bigint;
  /// USDC raised so far, and the amount that graduates the curve, in dollars.
  raisedUsd: number;
  goalUsd: number;
  graduationMcapUsd: number;
};

const CONFIG_FIELDS = [
  "TOTAL_SUPPLY",
  "curveSupply",
  "lpSupply",
  "virtualUsdc",
  "virtualTokens",
  "graduationUsdc",
  "tradeFeeBps",
  "protocolFeeBps",
  "launchFee",
  "MAX_CREATOR_TAX_BPS",
  "MAX_SNIPE_EXEMPT",
  "SNIPE_WINDOW",
] as const;

/// Reads the curve's immutables once. They never change, so there is no poll.
export function useCurveConfig(): CurveConfig | null {
  const { data } = useReadContracts({
    contracts: CONFIG_FIELDS.map(
      (functionName) => ({ address: CURVE_ADDRESS, abi: curveAbi, functionName }) as const,
    ),
    query: { enabled: isCurveDeployed, staleTime: Infinity },
  });

  return useMemo(() => {
    if (!data || data.some((d) => d.status !== "success")) return null;
    const r = data.map((d) => d.result);
    return {
      totalSupply: r[0] as bigint,
      curveSupply: r[1] as bigint,
      lpSupply: r[2] as bigint,
      virtualUsdc: r[3] as bigint,
      virtualTokens: r[4] as bigint,
      graduationUsdc: r[5] as bigint,
      tradeFeeBps: Number(r[6]),
      protocolFeeBps: Number(r[7]),
      launchFee: r[8] as bigint,
      maxCreatorTaxBps: Number(r[9]),
      maxSnipeExempt: Number(r[10]),
      snipeWindow: Number(r[11]),
    };
  }, [data]);
}

// ---------------------------------------------------------------------------
// Math. Mirrors TsukiCurve exactly; the contract remains the source of truth
// for anything that moves money (quotes come from `quoteBuy` / `quoteSell`).
// ---------------------------------------------------------------------------

const USDC_UNIT = 10 ** USDC_DECIMALS;
const TOKEN_UNIT = 10 ** TOKEN_DECIMALS;

/// Spot price in dollars per whole token.
export function curvePriceUsd(cfg: CurveConfig, sold: bigint, raised: bigint): number {
  const usdc = Number(cfg.virtualUsdc + raised) / USDC_UNIT;
  const tokens = Number(cfg.virtualTokens + cfg.totalSupply - sold) / TOKEN_UNIT;
  return usdc / tokens;
}

export function curveMarketCapUsd(cfg: CurveConfig, sold: bigint, raised: bigint): number {
  return curvePriceUsd(cfg, sold, raised) * (Number(cfg.totalSupply) / TOKEN_UNIT);
}

export function openingMarketCapUsd(cfg: CurveConfig): number {
  return curveMarketCapUsd(cfg, 0n, 0n);
}

/// Market cap at the moment the curve sells out, which is also where the pool opens.
export function graduationMarketCapUsd(cfg: CurveConfig): number {
  const usdc = Number(cfg.virtualUsdc + cfg.graduationUsdc) / USDC_UNIT;
  const tokens = Number(cfg.virtualTokens + cfg.lpSupply) / TOKEN_UNIT;
  return (usdc / tokens) * (Number(cfg.totalSupply) / TOKEN_UNIT);
}

/// Gross USDC a buyer spends to take a fresh curve all the way to graduation.
export function grossToGraduateUsd(cfg: CurveConfig, creatorTaxBps = 0): number {
  const feeBps = cfg.tradeFeeBps + creatorTaxBps;
  return Number(cfg.graduationUsdc) / USDC_UNIT / (1 - feeBps / 10_000);
}

/// Snipe tax a buyer would pay `elapsed` seconds after launch, in bps.
export function snipeTaxBpsAt(elapsed: number): number {
  if (elapsed < 0 || elapsed >= 5) return elapsed < 0 ? 9_900 : 0;
  return 9_900 >> (2 * Math.floor(elapsed));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/// Shapes a curve launch like a direct launch, so the board, cards, ticker and
/// sorting treat both kinds the same. Fields that only mean something for a
/// direct launch's range are zeroed; `curve` carries what is curve-specific.
function toLaunchView(
  cfg: CurveConfig,
  c: RawCurve,
  extra: {
    name: string;
    symbol: string;
    metadataURI: string;
    rewardsEnabled: boolean;
    totalRewardsReceived: bigint;
    sqrtPriceX96?: bigint;
  },
): LaunchView {
  const supplyWhole = cfg.totalSupply / 10n ** BigInt(TOKEN_DECIMALS);
  const goalUsd = Number(cfg.graduationUsdc) / USDC_UNIT;
  const raisedUsd = Number(c.usdcRaised) / USDC_UNIT;
  const graduationMcapUsd = graduationMarketCapUsd(cfg);

  const marketCapUsd =
    c.graduated && extra.sqrtPriceX96
      ? marketCapFromSqrtPriceX96(extra.sqrtPriceX96, supplyWhole)
      : curveMarketCapUsd(cfg, c.tokensSold, c.usdcRaised);

  const curveProgress = c.graduated ? 1 : Number((c.tokensSold * 1_000_000n) / cfg.curveSupply) / 1_000_000;

  return {
    kind: "curve",
    token: c.token,
    pool: c.pool,
    creator: c.creator,
    feeRecipient: c.feeRecipient,
    tickLower: 0,
    tickUpper: 0,
    liquidity: c.liquidity,
    createdAt: c.createdAt,
    creatorAllocation: 0n,
    buybackAndBurn: false,
    usdcSpentOnBuybacks: 0n,
    tokensBurned: 0n,
    name: extra.name,
    symbol: extra.symbol,
    totalSupply: cfg.totalSupply,
    supplyWhole,
    metadataURI: extra.metadataURI,
    currentTick: 0,
    sqrtPriceX96: extra.sqrtPriceX96 ?? 0n,
    marketCapUsd,
    priceUsd: marketCapUsd / Number(supplyWhole),
    startMarketCapUsd: openingMarketCapUsd(cfg),
    ceilingMarketCapUsd: graduationMcapUsd,
    curveProgress,
    remainingCapacityUsd: c.graduated ? 0 : Math.max(0, goalUsd - raisedUsd),
    totalCapacityUsd: goalUsd,
    rewardsEnabled: extra.rewardsEnabled,
    totalRewardsReceived: extra.totalRewardsReceived,
    curve: {
      tokensSold: c.tokensSold,
      usdcRaised: c.usdcRaised,
      graduated: c.graduated,
      creatorTaxBps: Number(c.creatorTaxBps),
      curveSupply: cfg.curveSupply,
      raisedUsd,
      goalUsd,
      graduationMcapUsd,
    },
  };
}

function detailCalls(c: RawCurve) {
  return [
    { address: c.token, abi: launchTokenAbi, functionName: "name" },
    { address: c.token, abi: launchTokenAbi, functionName: "symbol" },
    { address: c.token, abi: launchTokenAbi, functionName: "metadataURI" },
    { address: c.token, abi: launchTokenAbi, functionName: "rewardsEnabled" },
    { address: c.token, abi: launchTokenAbi, functionName: "totalRewardsReceived" },
    // A curve has no pool until it graduates; reading an uninitialised pool id
    // fails harmlessly and keeps every entry the same width.
    { address: STATE_VIEW_ADDRESS, abi: stateViewAbi, functionName: "getSlot0", args: [poolIdFor(c.token)] },
  ] as const;
}
const DETAIL_WIDTH = 6;

function buildFromDetails(
  cfg: CurveConfig,
  c: RawCurve,
  d: readonly { result?: unknown; status: string }[] | undefined,
  base: number,
): LaunchView | null {
  const name = d?.[base]?.result as string | undefined;
  const symbol = d?.[base + 1]?.result as string | undefined;
  if (name === undefined || symbol === undefined) return null;
  const slot0 = c.graduated
    ? (d?.[base + 5]?.result as readonly [bigint, ...unknown[]] | undefined)
    : undefined;
  return toLaunchView(cfg, c, {
    name,
    symbol,
    metadataURI: (d?.[base + 2]?.result as string | undefined) ?? "",
    rewardsEnabled: (d?.[base + 3]?.result as boolean | undefined) ?? false,
    totalRewardsReceived: (d?.[base + 4]?.result as bigint | undefined) ?? 0n,
    sqrtPriceX96: slot0?.[0],
  });
}

/// The newest curve launches, newest first.
export function useCurveLaunches(limit = 30) {
  const cfg = useCurveConfig();

  const count = useReadContract({
    address: CURVE_ADDRESS,
    abi: curveAbi,
    functionName: "curveCount",
    query: { enabled: isCurveDeployed, refetchInterval: 20_000 },
  });
  const total = Number((count.data as bigint | undefined) ?? 0n);
  const indices = useMemo(
    () => Array.from({ length: Math.min(limit, total) }, (_, i) => BigInt(total - 1 - i)),
    [limit, total],
  );

  const entries = useReadContracts({
    contracts: indices.map(
      (i) => ({ address: CURVE_ADDRESS, abi: curveAbi, functionName: "curveAt", args: [i] }) as const,
    ),
    query: { enabled: indices.length > 0, refetchInterval: 15_000 },
  });
  const raw = useMemo(
    () =>
      (entries.data ?? [])
        .map((e) => e.result as RawCurve | undefined)
        .filter((c): c is RawCurve => !!c),
    [entries.data],
  );

  const details = useReadContracts({
    contracts: raw.flatMap(detailCalls),
    query: { enabled: raw.length > 0, refetchInterval: 20_000 },
  });

  const launches = useMemo<LaunchView[]>(() => {
    if (!cfg || !details.data) return [];
    return raw
      .map((c, i) => buildFromDetails(cfg, c, details.data, i * DETAIL_WIDTH))
      .filter((l): l is LaunchView => l !== null);
  }, [cfg, raw, details.data]);

  return {
    launches,
    isLoading:
      isCurveDeployed && (count.isLoading || (total > 0 && (entries.isLoading || details.isLoading || !cfg))),
    error: count.error ?? entries.error ?? details.error ?? null,
  };
}

/// One curve launch, for its token page.
export function useCurveLaunch(token: Address | undefined) {
  const cfg = useCurveConfig();
  const entry = useReadContract({
    address: CURVE_ADDRESS,
    abi: curveAbi,
    functionName: "curveOf",
    args: token ? [token] : undefined,
    query: { enabled: isCurveDeployed && !!token, refetchInterval: 5_000 },
  });
  const c = entry.data as RawCurve | undefined;

  const details = useReadContracts({
    contracts: c ? [...detailCalls(c)] : [],
    query: { enabled: !!c, refetchInterval: 10_000 },
  });

  const launch = useMemo(() => {
    if (!cfg || !c || !details.data) return null;
    return buildFromDetails(cfg, c, details.data, 0);
  }, [cfg, c, details.data]);

  return {
    launch,
    config: cfg,
    isLoading: entry.isLoading || details.isLoading || (!!c && !cfg),
    error: entry.error ?? details.error ?? null,
    refetch: () => {
      void entry.refetch();
      void details.refetch();
    },
  };
}
