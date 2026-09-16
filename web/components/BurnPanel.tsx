"use client";

import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, usePublicClient, useReadContracts, useWriteContract } from "wagmi";

import { Badge, Button, Card } from "./ui";
import { hookAbi, launchpadAbi, stateViewAbi } from "@/lib/abi";
import { pendingFees } from "@/lib/fees";
import { poolIdFor, poolKeyFor } from "@/lib/v4";
import {
  HOOK_ADDRESS,
  LAUNCHPAD_ADDRESS,
  STATE_VIEW_ADDRESS,
  TOKEN_DECIMALS,
  USDC_DECIMALS,
  chain,
} from "@/lib/config";
import { compactNumber, formatUsd, formatUnitsFloat } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { LaunchView } from "@/lib/hooks";

/// Shows the cumulative effect of the buy-back-and-burn fee mode.
///
/// Unlike the other fee modes there is nothing to claim here — the value goes to
/// every holder implicitly, by removing supply. So the panel is a scoreboard,
/// plus the same permissionless "sweep fees" trigger the rewards panel offers.
export function BurnPanel({ launch }: { launch: LaunchView }) {
  const t = useT();
  const { isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);

  // What pressing the button would actually burn right now. Without this the
  // control looks identical whether there is $5 of fees waiting or nothing at
  // all, so a press that correctly does nothing reads as the feature being
  // broken.
  const poolId = useMemo(() => poolIdFor(launch.token), [launch.token]);
  const key = useMemo(() => poolKeyFor(launch.token), [launch.token]);
  const ZERO_SALT = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

  const { data: feeData } = useReadContracts({
    contracts: [
      {
        address: STATE_VIEW_ADDRESS,
        abi: stateViewAbi,
        functionName: "getPositionInfo",
        args: [poolId, LAUNCHPAD_ADDRESS, launch.tickLower, launch.tickUpper, ZERO_SALT],
      },
      {
        address: STATE_VIEW_ADDRESS,
        abi: stateViewAbi,
        functionName: "getFeeGrowthInside",
        args: [poolId, launch.tickLower, launch.tickUpper],
      },
      // The creator tax the hook is holding is swept by the same call, so it is
      // part of what a press would burn.
      { address: HOOK_ADDRESS, abi: hookAbi, functionName: "owed", args: [poolId, key.currency0] },
      { address: HOOK_ADDRESS, abi: hookAbi, functionName: "owed", args: [poolId, key.currency1] },
      { address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, functionName: "protocolFeeBps" },
    ] as const,
    query: { refetchInterval: 15_000 },
  });

  const ready = useMemo(() => {
    if (!feeData || feeData.some((d) => d.status !== "success")) return null;
    const pos = feeData[0].result as readonly [bigint, bigint, bigint];
    const inside = feeData[1].result as readonly [bigint, bigint];
    const owed = pendingFees({
      liquidity: pos[0],
      feeGrowthInside0LastX128: pos[1],
      feeGrowthInside1LastX128: pos[2],
      feeGrowthInside0X128: inside[0],
      feeGrowthInside1X128: inside[1],
    });
    const tax0 = feeData[2].result as bigint;
    const tax1 = feeData[3].result as bigint;
    const protocolBps = BigInt(Number(feeData[4].result));

    // The token side is burned outright and the USDC side buys more to burn, so
    // both count. Priced in USDC at spot to give one comparable number.
    const supply = Number(launch.supplyWhole);
    const priceUsd = supply > 0 ? launch.marketCapUsd / supply : 0;
    const tokenSide = owed.token + tax0;
    const tokenAsUsdc =
      priceUsd > 0 ? BigInt(Math.floor((Number(tokenSide) / 1e18) * priceUsd * 1e6)) : 0n;
    const total = owed.usdc + tax1 + tokenAsUsdc;
    // The treasury's cut is not burned; only the creator's share is.
    return total - (total * protocolBps) / 10_000n;
  }, [feeData, launch.supplyWhole, launch.marketCapUsd]);

  const nothingToBurn = ready !== null && ready === 0n;

  // Below every hook on purpose: an early return above them would change how
  // many hooks run between a burn launch and an ordinary one, and React reuses
  // this component across tokens.
  if (!launch.buybackAndBurn) return null;

  const burned = formatUnitsFloat(launch.tokensBurned, TOKEN_DECIMALS);
  const spent = formatUnitsFloat(launch.usdcSpentOnBuybacks, USDC_DECIMALS);

  // totalSupply already excludes burns, so the original is current + destroyed.
  const currentSupply = Number(formatUnits(launch.totalSupply, TOKEN_DECIMALS));
  const originalSupply = currentSupply + burned;
  const pctGone = originalSupply > 0 ? (burned / originalSupply) * 100 : 0;

  async function handleSweep() {
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
      // Nothing to sweep yet, or the user rejected.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-pink p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="eyebrow">{t("burn.title")}</p>
        <Badge tone="pink">{t("token.deflationary")}</Badge>
      </div>

      <p className="text-xs leading-relaxed text-muted">
        {t("burn.body", { sym: `$${launch.symbol}` })}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-4 border-t-2 border-line pt-4">
        <div>
          <p className="eyebrow">{t("burn.spent")}</p>
          <p className="tabular text-2xl font-bold">{formatUsd(spent)}</p>
        </div>
        <div>
          <p className="eyebrow">{t("burn.burned")}</p>
          <p className="tabular text-2xl font-bold text-pink">
            {burned > 0 ? compactNumber(burned) : "0"}
          </p>
        </div>
      </div>

      {burned > 0 ? (
        <p className="tabular mt-3 text-xs text-muted">
          {t("burn.ofSupply", { pct: `${pctGone < 0.01 ? "<0.01" : pctGone.toFixed(2)}%` })}
        </p>
      ) : null}

      {ready !== null ? (
        <p className="tabular mt-3 border-t-2 border-line pt-3 text-xs text-muted">
          {nothingToBurn
            ? t("burn.nothingWaiting")
            : t("burn.waiting", { amt: formatUsd(formatUnitsFloat(ready, USDC_DECIMALS)) })}
        </p>
      ) : null}

      {/* A real button, not a footnote. The burn only happens when somebody
          calls it, so the one control that makes this panel's numbers move has
          to look like the thing to press. */}
      <Button
        className="mt-4 w-full"
        variant="pink"
        onClick={handleSweep}
        disabled={busy || !isConnected || chainId !== chain.id || nothingToBurn}
      >
        {busy ? t("burn.burning") : nothingToBurn ? t("burn.nothingYet") : t("burn.sweep")}
      </Button>
      <p className="mt-2 text-center text-[0.6875rem] leading-relaxed text-faint">
        {t("burn.sweepHint")}
      </p>
    </Card>
  );
}
