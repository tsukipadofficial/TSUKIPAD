"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";

import { Button, Card } from "./ui";
import { curveAbi } from "@/lib/abi";
import { CURVE_ADDRESS, USDC_DECIMALS, chain } from "@/lib/config";
import { formatUnitsFloat, formatUsd, shortAddress } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { LaunchView } from "@/lib/hooks";

/// The creator share of a curve launch's fees.
///
/// Curve trades accrue fees on the curve contract as they happen. After
/// graduation the locked pool earns its own 1% fee, which has to be collected
/// into the same balance first. Both actions are permissionless and can only
/// ever pay the recipient fixed at launch, so the buttons show for everyone.
export function CurveFeesPanel({ launch }: { launch: LaunchView }) {
  const t = useT();
  const { isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<"pay" | "collect" | null>(null);

  const { data: owed, refetch } = useReadContract({
    address: CURVE_ADDRESS,
    abi: curveAbi,
    functionName: "creatorFeesOwed",
    args: [launch.token],
    query: { refetchInterval: 15_000 },
  });

  const owedUsd = formatUnitsFloat((owed as bigint | undefined) ?? 0n, USDC_DECIMALS);
  const graduated = !!launch.curve?.graduated;
  const canAct = isConnected && chainId === chain.id;

  async function run(kind: "pay" | "collect") {
    setBusy(kind);
    try {
      const hash = await writeContractAsync({
        address: CURVE_ADDRESS,
        abi: curveAbi,
        functionName: kind === "pay" ? "claimCreatorFees" : "collectFees",
        args: [launch.token],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      await refetch();
    } catch {
      // Rejected, or nothing to pay out yet.
    } finally {
      setBusy(null);
    }
  }

  const to = launch.rewardsEnabled ? t("curve.fees.holders") : shortAddress(launch.feeRecipient);

  return (
    <Card className="p-4">
      <p className="eyebrow mb-2">{t("curve.fees.title")}</p>
      <p className="tabular text-3xl font-bold text-lime">{formatUsd(owedUsd)}</p>
      <p className="eyebrow mb-3 mt-1">{t("curve.fees.owed")}</p>
      <p className="text-xs leading-relaxed text-muted">{t("curve.fees.body", { to })}</p>
      {/* Holder-reward launches pay out through the rewards panel instead. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {!launch.rewardsEnabled ? (
          <Button size="sm" disabled={!canAct || owedUsd === 0 || busy !== null} onClick={() => run("pay")}>
            {busy === "pay" ? t("curve.fees.working") : t("curve.fees.pay")}
          </Button>
        ) : null}
        {graduated ? (
          <Button size="sm" variant="ghost" disabled={!canAct || busy !== null} onClick={() => run("collect")}>
            {busy === "collect" ? t("curve.fees.working") : t("curve.fees.collect")}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
