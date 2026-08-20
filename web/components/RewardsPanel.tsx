"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";

import { Badge, Button, Card, cx } from "./ui";
import { launchTokenAbi, launchpadAbi } from "@/lib/abi";
import { LAUNCHPAD_ADDRESS, USDC_DECIMALS, chain } from "@/lib/config";
import { formatUsd, formatUnitsFloat } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { LaunchView } from "@/lib/hooks";

/// Claim panel for launches that share swap fees with holders.
///
/// Rewards are paid in USDC, so this is genuinely cashable — not a rebasing
/// balance or a claim on more of the same token.
export function RewardsPanel({ launch }: { launch: LaunchView }) {
  const t = useT();
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [busy, setBusy] = useState(false);
  const [justClaimed, setJustClaimed] = useState<number | null>(null);

  const wrongChain = isConnected && chainId !== chain.id;

  const { data: pending, refetch: refetchPending } = useReadContract({
    address: launch.token,
    abi: launchTokenAbi,
    functionName: "pendingRewards",
    args: address ? [address] : undefined,
    query: {
      enabled: launch.rewardsEnabled && !!address && !wrongChain,
      refetchInterval: 10_000,
    },
  });

  const { data: balance } = useReadContract({
    address: launch.token,
    abi: launchTokenAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: launch.rewardsEnabled && !!address, refetchInterval: 15_000 },
  });

  useEffect(() => {
    if (justClaimed === null) return;
    const t = setTimeout(() => setJustClaimed(null), 6_000);
    return () => clearTimeout(t);
  }, [justClaimed]);

  if (!launch.rewardsEnabled) return null;

  const pendingUsd = pending ? formatUnitsFloat(pending as bigint, USDC_DECIMALS) : 0;
  const lifetimeUsd = formatUnitsFloat(launch.totalRewardsReceived, USDC_DECIMALS);
  const holds = balance !== undefined && (balance as bigint) > 0n;

  async function handleClaim() {
    if (!address) return;
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: launch.token,
        abi: launchTokenAbi,
        functionName: "claimRewards",
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      setJustClaimed(pendingUsd);
      await refetchPending();
    } catch {
      // Rejected or nothing to claim; the panel simply stays as it was.
    } finally {
      setBusy(false);
    }
  }

  /// Sweep fees from the pool into the token so they become claimable.
  /// Permissionless — proceeds always go to holders and the treasury.
  async function handleSync() {
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: LAUNCHPAD_ADDRESS,
        abi: launchpadAbi,
        functionName: "collectFees",
        args: [launch.token],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      await refetchPending();
    } catch {
      // No fees to sweep yet, or user rejected.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={cx("p-4", pendingUsd > 0 && "border-lime")}>
      <div className="mb-3 flex items-center justify-between">
        <p className="eyebrow">{t("rewards.title")}</p>
        <Badge tone="lime">USDC</Badge>
      </div>

      <p className="text-xs leading-relaxed text-muted">
        {t("rewards.body", { sym: `$${launch.symbol}` })}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-4 border-t-2 border-line pt-4">
        <div>
          <p className="eyebrow">{t("rewards.canClaim")}</p>
          <p
            className={cx(
              "tabular text-2xl font-bold",
              pendingUsd > 0 ? "text-lime" : "text-faint",
            )}
          >
            {pendingUsd > 0 ? `$${pendingUsd.toFixed(4)}` : "$0"}
          </p>
        </div>
        <div>
          <p className="eyebrow">{t("rewards.paidOut")}</p>
          <p className="tabular text-2xl font-bold">{formatUsd(lifetimeUsd)}</p>
        </div>
      </div>

      {justClaimed !== null ? (
        <p className="mt-3 border-2 border-lime p-2 text-xs font-bold text-lime">
          {t("rewards.claimed", { amount: `$${justClaimed.toFixed(4)}` })}
        </p>
      ) : null}

      <div className="mt-3 space-y-2">
        <Button
          className="w-full"
          disabled={!isConnected || wrongChain || busy || pendingUsd <= 0}
          onClick={handleClaim}
        >
          {busy
            ? t("cta.working")
            : !isConnected
              ? t("cta.connect")
              : pendingUsd > 0
                ? t("rewards.claim", { amount: `$${pendingUsd.toFixed(4)}` })
                : holds
                  ? t("rewards.nothingYet")
                  : t("rewards.buyToEarn", { sym: launch.symbol })}
        </Button>

        <button
          onClick={handleSync}
          disabled={busy || !isConnected || wrongChain}
          className="w-full text-center text-[0.6875rem] text-faint underline-offset-4 transition-colors hover:text-cyan hover:underline disabled:opacity-50"
        >
          {t("rewards.sweep")}
        </button>
      </div>
    </Card>
  );
}
