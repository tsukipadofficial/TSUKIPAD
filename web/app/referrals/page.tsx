"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { zeroAddress } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";

import { Button, Card, cx } from "@/components/ui";
import { launchpadAbi } from "@/lib/abi";
import { LAUNCHPAD_ADDRESS, SITE_ORIGIN } from "@/lib/config";
import { referralLink } from "@/lib/referral";
import { formatUsd, shortAddress } from "@/lib/format";
import { useLaunches } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n";

/// A referrer's own page: their link, and the launches it brought in.
///
/// Earnings are not held anywhere waiting to be claimed -- a referral is paid
/// straight to the referrer's wallet whenever anyone collects that launch's
/// fees. So this page is a ledger and a set of triggers, not a wallet.
export default function ReferralsPage() {
  const { t } = useI18n();
  const { address, isConnected } = useAccount();
  const { login, ready } = usePrivy();
  const { launches, isLoading } = useLaunches(60);
  const [copied, setCopied] = useState(false);

  // Which of these launches name me as the referrer?
  const { data } = useReadContracts({
    contracts: launches.map(
      (l) =>
        ({
          address: LAUNCHPAD_ADDRESS,
          abi: launchpadAbi,
          functionName: "referralOf",
          args: [l.token],
        }) as const,
    ),
    query: { enabled: launches.length > 0, refetchInterval: 30_000 },
  });

  const mine = useMemo(() => {
    if (!data || !address) return [];
    return launches.flatMap((l, i) => {
      const r = data[i];
      if (r?.status !== "success") return [];
      const [who, bps] = r.result as readonly [string, number];
      if (who.toLowerCase() !== address.toLowerCase()) return [];
      return [{ launch: l, bps }];
    });
  }, [data, launches, address]);

  const link = address ? referralLink(SITE_ORIGIN, address) : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the link is on screen to select by hand */
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-14">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("ref.title")}</h1>
      <p className="mt-3 max-w-2xl text-muted">{t("ref.sub")}</p>

      {!isConnected ? (
        <Card className="mt-8 p-8 text-center">
          <p className="text-sm text-muted">{t("ref.signInFirst")}</p>
          <Button className="mt-4" disabled={!ready} onClick={() => login()}>
            {t("nav.connect")}
          </Button>
        </Card>
      ) : (
        <>
          <Card className="mt-8 p-6">
            <p className="eyebrow">{t("ref.yourLink")}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="flex-1 overflow-x-auto whitespace-nowrap border-2 border-line bg-void px-3 py-2.5 font-mono text-sm text-ink">
                {link}
              </code>
              <Button onClick={() => void copy()} className={cx(copied && "bg-lime")}>
                {copied ? t("nav.copied") : t("ref.copy")}
              </Button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-faint">{t("ref.howItWorks")}</p>
          </Card>

          <div className="mt-10 flex items-baseline justify-between">
            <h2 className="text-2xl font-bold">{t("ref.yourLaunches")}</h2>
            <span className="font-mono text-sm text-muted">
              {t("ref.count", { n: String(mine.length) })}
            </span>
          </div>

          <Card className="mt-4 divide-y-2 divide-line">
            {isLoading ? (
              <p className="px-5 py-8 text-center font-mono text-sm text-faint">{t("ref.loading")}</p>
            ) : mine.length === 0 ? (
              <p className="px-5 py-8 text-center font-mono text-sm text-faint">{t("ref.empty")}</p>
            ) : (
              mine.map(({ launch, bps }) => (
                <Link
                  key={launch.token}
                  href={`/token/${launch.token}`}
                  className="flex items-center gap-4 px-5 py-3 hover:bg-surface-2"
                >
                  <span className="flex-1 truncate">
                    <span className="font-bold text-ink">{launch.name}</span>
                    <span className="ml-2 font-mono text-xs text-faint">${launch.symbol}</span>
                  </span>
                  <span className="tabular hidden text-sm text-muted sm:inline">
                    {formatUsd(launch.marketCapUsd)}
                  </span>
                  <span className="tabular text-sm text-lime">{bps / 100}%</span>
                </Link>
              ))
            )}
          </Card>

          <p className="mt-6 text-xs leading-relaxed text-faint">{t("ref.paidAutomatically")}</p>
        </>
      )}
    </main>
  );
}
