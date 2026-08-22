"use client";

import { useMemo, useState } from "react";
import { zeroAddress } from "viem";
import { useAccount, usePublicClient, useReadContracts, useWriteContract } from "wagmi";

import { Button, Card, cx } from "./ui";
import { launchpadAbi, uniswapV3PoolAbi } from "@/lib/abi";
import { LAUNCHPAD_ADDRESS, USDC_DECIMALS, chain } from "@/lib/config";
import { formatUsd, formatUnitsFloat, shortAddress } from "@/lib/format";
import { pendingFees, positionKey, splitFees, type PositionInfo, type TickInfo } from "@/lib/fees";
import { useT } from "@/lib/i18n";
import type { LaunchView } from "@/lib/hooks";

/// What a launch has earned and has not yet paid out, and the button that pays it.
///
/// Collecting is permissionless: whoever presses this settles the creator, the
/// treasury and any referrer in one transaction, to the addresses recorded
/// on-chain at launch. The caller cannot redirect a penny of it, which is why
/// the button is shown to everyone rather than gated to the creator -- gating it
/// would only mean fees sit uncollected whenever the creator is away.
/// What the panel's headline should add up to: the rows on screen, not the
/// whole pot. A total that exceeds its own breakdown reads like something is
/// being withheld.
function rowsTotal(
  view: { usdcSide: bigint; split: { creator: bigint; treasury: bigint; referrer: bigint } },
  includeTreasury: boolean,
): bigint {
  return view.split.creator + view.split.referrer + (includeTreasury ? view.split.treasury : 0n);
}

export function FeesPanel({ launch }: { launch: LaunchView }) {
  const t = useT();
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);

  const pool = launch.pool;
  const key = useMemo(
    () => positionKey(LAUNCHPAD_ADDRESS, launch.tickLower, launch.tickUpper),
    [launch.tickLower, launch.tickUpper],
  );

  const { data } = useReadContracts({
    contracts: [
      { address: pool, abi: uniswapV3PoolAbi, functionName: "positions", args: [key] },
      { address: pool, abi: uniswapV3PoolAbi, functionName: "ticks", args: [launch.tickLower] },
      { address: pool, abi: uniswapV3PoolAbi, functionName: "ticks", args: [launch.tickUpper] },
      { address: pool, abi: uniswapV3PoolAbi, functionName: "feeGrowthGlobal0X128" },
      { address: pool, abi: uniswapV3PoolAbi, functionName: "feeGrowthGlobal1X128" },
      { address: pool, abi: uniswapV3PoolAbi, functionName: "slot0" },
      { address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, functionName: "protocolFeeBps" },
      { address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, functionName: "referralOf", args: [launch.token] },
      { address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, functionName: "treasury" },
    ] as const,
    query: { refetchInterval: 20_000 },
  });

  const view = useMemo(() => {
    if (!data || data.some((d) => d.status !== "success")) return null;

    const pos = data[0].result as readonly [bigint, bigint, bigint, bigint, bigint];
    const lo = data[1].result as readonly unknown[];
    const hi = data[2].result as readonly unknown[];
    const slot0 = data[5].result as readonly [bigint, number, ...unknown[]];

    const position: PositionInfo = {
      liquidity: pos[0],
      feeGrowthInside0LastX128: pos[1],
      feeGrowthInside1LastX128: pos[2],
      tokensOwed0: pos[3],
      tokensOwed1: pos[4],
    };
    // ticks() returns feeGrowthOutside at indices 2 and 3.
    const lower: TickInfo = {
      feeGrowthOutside0X128: lo[2] as bigint,
      feeGrowthOutside1X128: lo[3] as bigint,
    };
    const upper: TickInfo = {
      feeGrowthOutside0X128: hi[2] as bigint,
      feeGrowthOutside1X128: hi[3] as bigint,
    };

    const owed = pendingFees({
      position,
      lower,
      upper,
      feeGrowthGlobal0X128: data[3].result as bigint,
      feeGrowthGlobal1X128: data[4].result as bigint,
      tickCurrent: slot0[1],
      tickLower: launch.tickLower,
      tickUpper: launch.tickUpper,
    });

    const referral = data[7].result as readonly [string, number];
    const hasReferrer = referral[0] !== zeroAddress;

    // The token side is sold for USDC before anything is split, so the preview
    // treats it as USDC at the pool's current price. The chain decides the real
    // figure; this is close enough to tell somebody whether it is worth a click.
    const supply = Number(launch.supplyWhole);
    const priceUsd = supply > 0 ? launch.marketCapUsd / supply : 0;
    const tokenAsUsdc =
      priceUsd > 0 ? BigInt(Math.floor((Number(owed.token) / 1e18) * priceUsd * 1e6)) : 0n;
    const usdcSide = owed.usdc + tokenAsUsdc;

    return {
      usdcSide,
      treasury: data[8].result as `0x${string}`,
      referrer: referral[0] as `0x${string}`,
      hasReferrer,
      split: splitFees({
        usdcSide,
        protocolFeeBps: Number(data[6].result),
        referralBps: Number(referral[1]),
        hasReferrer,
      }),
    };
  }, [data, launch.tickLower, launch.tickUpper, launch.marketCapUsd, launch.supplyWhole]);

  const wrongChain = isConnected && chainId !== chain.id;

  async function collect() {
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: LAUNCHPAD_ADDRESS,
        abi: launchpadAbi,
        functionName: "collectFees",
        args: [launch.token],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
    } catch {
      /* rejected in the wallet, or nothing to collect */
    } finally {
      setBusy(false);
    }
  }

  // Buy-and-burn has its own scoreboard; holder rewards have their own claim.
  if (launch.buybackAndBurn || launch.rewardsEnabled) return null;

  // On an earmarked launch the creator's share is not paid to anyone: it is
  // held until the named account proves itself. Labelling it "Creator" claimed
  // the money was going somewhere it is not.
  const earmarked = launch.feeRecipient === zeroAddress;
  const youAreRecipient =
    !earmarked && !!address && address.toLowerCase() === launch.feeRecipient.toLowerCase();
  const youAreReferrer =
    !!address && !!view?.hasReferrer && address.toLowerCase() === view.referrer.toLowerCase();

  // The launch's own share is public: the person it is earmarked for has to be
  // able to see what is waiting before they know it is worth signing in for.
  //
  // The protocol's share is shown only to the treasury. Everything here is
  // readable on-chain by anyone, so this is tidiness rather than secrecy -- but
  // a stranger has no use for our cut, and showing it invites the reading that
  // it is somehow theirs.
  const youAreTreasury =
    !!address && !!view && address.toLowerCase() === view.treasury.toLowerCase();

  const rows: { label: string; value: bigint; mine: boolean }[] = view
    ? [
        {
          label: earmarked ? t("fees.row.earmarked") : t("fees.row.creator"),
          value: view.split.creator,
          mine: youAreRecipient,
        },
        ...(view.hasReferrer
          ? [{ label: t("fees.row.referrer"), value: view.split.referrer, mine: youAreReferrer }]
          : []),
        ...(youAreTreasury
          ? [{ label: t("fees.row.protocol"), value: view.split.treasury, mine: true }]
          : []),
      ]
    : [];

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between">
        <p className="eyebrow">{t("fees.title")}</p>
        <span className="font-mono text-xs text-faint">
          {view
            ? formatUsd(
                Number(rowsTotal(view, youAreTreasury)) / 1e6,
              )
            : "—"}
        </span>
      </div>

      <div className="mt-3 divide-y divide-line border-2 border-line">
        {rows.length === 0 ? (
          <p className="px-3 py-4 text-center font-mono text-xs text-faint">{t("fees.loading")}</p>
        ) : (
          rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between px-3 py-2">
              <span className={cx("font-mono text-xs", r.mine ? "text-lime" : "text-muted")}>
                {r.label}
                {r.mine ? ` — ${t("fees.you")}` : ""}
              </span>
              <span className={cx("tabular text-sm", r.mine ? "text-lime" : "text-ink")}>
                {formatUsd(Number(r.value) / 1e6)}
              </span>
            </div>
          ))
        )}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-faint">
        {earmarked ? t("fees.anyoneEarmarked") : t("fees.anyone")}
      </p>

      <Button
        className="mt-3 w-full"
        disabled={busy || wrongChain || !isConnected || !view || view.usdcSide === 0n}
        onClick={() => void collect()}
      >
        {busy ? t("fees.collecting") : t("fees.collect")}
      </Button>
    </Card>
  );
}
