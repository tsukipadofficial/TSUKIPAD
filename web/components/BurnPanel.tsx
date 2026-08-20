"use client";

import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";

import { Badge, Button, Card } from "./ui";
import { launchpadAbi } from "@/lib/abi";
import { LAUNCHPAD_ADDRESS, TOKEN_DECIMALS, USDC_DECIMALS, chain } from "@/lib/config";
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

      <button
        onClick={handleSweep}
        disabled={busy || !isConnected || chainId !== chain.id}
        className="mt-3 w-full text-center text-[0.6875rem] text-faint underline-offset-4 transition-colors hover:text-pink hover:underline disabled:opacity-50"
      >
        {t("rewards.sweep")}
      </button>
    </Card>
  );
}
