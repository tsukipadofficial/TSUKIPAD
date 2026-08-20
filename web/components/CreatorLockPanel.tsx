"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";

import { Badge, Button, Card, cx } from "./ui";
import { launchpadAbi } from "@/lib/abi";
import { LAUNCHPAD_ADDRESS, TOKEN_DECIMALS, chain } from "@/lib/config";
import { countdown, shortAddress } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { LaunchView } from "@/lib/hooks";

/// Shows the state of the creator's withheld allocation.
///
/// This is the only supply outside the locked pool, so buyers care about it more
/// than anything else on the page: while it is held, there is nothing the
/// launcher can dump on them.
export function CreatorLockPanel({ launch }: { launch: LaunchView }) {
  const { t, lang } = useI18n();
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  const unlockAt = Number(launch.unlockAt);
  const locked = !launch.allocationClaimed && now / 1000 < unlockAt;

  // Tick once a second only while there is actually a countdown to show.
  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [locked]);

  if (launch.creatorAllocation === 0n) return null;

  const amount = Number(formatUnits(launch.creatorAllocation, TOKEN_DECIMALS));
  const pctOfSupply = (amount / Number(launch.supplyWhole)) * 100;
  const isCreator = address?.toLowerCase() === launch.creator.toLowerCase();
  const claimable = !launch.allocationClaimed && !locked;

  async function handleClaim() {
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: LAUNCHPAD_ADDRESS,
        abi: launchpadAbi,
        functionName: "claimCreatorAllocation",
        args: [launch.token],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
    } catch {
      // Rejected, or already claimed by someone else in the meantime.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={cx("p-4", locked && "border-cyan")}>
      <div className="mb-3 flex items-center justify-between">
        <p className="eyebrow">{t("lock.title")}</p>
        <Badge tone={locked ? "cyan" : launch.allocationClaimed ? "line" : "amber"}>
          {locked ? t("lock.locked") : launch.allocationClaimed ? t("lock.released") : t("lock.unlocked")}
        </Badge>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="tabular text-2xl font-bold">
          {pctOfSupply.toFixed(1)}%
        </span>
        <span className="text-xs text-muted">
          {t("lock.ofSupply", {
            n: amount.toLocaleString("en-US", { maximumFractionDigits: 0 }),
            sym: launch.symbol,
          })}
        </span>
      </div>

      {locked ? (
        <>
          <p className="tabular mt-3 text-lg font-bold text-cyan">
            {countdown(unlockAt, lang)}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {t("lock.body")}
          </p>
        </>
      ) : launch.allocationClaimed ? (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {t("lock.releasedBody", { addr: shortAddress(launch.creator) })}
        </p>
      ) : (
        <>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            {t("lock.expiredBody")}
          </p>
          <Button
            className="mt-3 w-full"
            size="sm"
            variant="ghost"
            disabled={!isConnected || chainId !== chain.id || busy}
            onClick={handleClaim}
          >
            {busy ? t("lock.releasing") : isCreator ? t("lock.claim") : t("lock.release")}
          </Button>
        </>
      )}
    </Card>
  );
}
