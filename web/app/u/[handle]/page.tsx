"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";

import { Button, Card, cx } from "@/components/ui";
import { formatUsd, shortAddress } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type Profile = { handle: string; display: string; bio: string; wallet: string | null; createdAt: number };
type Pos = {
  token: string; value: number; cost: number; realized: number; unrealized: number;
  netPnl: number; avgEntry: number; trades: number; open: boolean;
};
type Totals = { netPnl: number; realized: number; unrealized: number; volume: number; value: number };

const money = (n: number) => `${n >= 0 ? "+" : "-"}${formatUsd(Math.abs(n))}`;
const tone = (n: number) => (n > 0 ? "text-lime" : n < 0 ? "text-pink" : "text-muted");

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={cx("tabular mt-1 text-lg", cls ?? "text-ink")}>{value}</p>
    </div>
  );
}

export default function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const { t } = useI18n();
  const { address } = useAccount();

  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [positions, setPositions] = useState<Pos[]>([]);
  const [tab, setTab] = useState<"open" | "closed">("open");

  useEffect(() => {
    let live = true;
    (async () => {
      const r = await fetch(`/api/profile?handle=${encodeURIComponent(handle)}`, { cache: "no-store" });
      const j = await r.json();
      if (!live) return;
      setProfile(j.profile ?? null);
      if (!j.profile?.wallet) return;
      const p = await fetch(`/api/leaderboard?wallet=${j.profile.wallet}`, { cache: "no-store" });
      const pj = await p.json();
      if (!live || !pj.ok) return;
      setTotals(pj.totals);
      setPositions(pj.positions ?? []);
    })();
    return () => { live = false; };
  }, [handle]);

  if (profile === undefined) {
    return <main className="mx-auto max-w-4xl px-5 py-20 text-center font-mono text-sm text-faint">…</main>;
  }

  if (profile === null) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-20">
        <Card className="p-12 text-center">
          <p className="text-2xl font-bold">{t("pf.notFound")}</p>
          <p className="mt-2 text-sm text-muted">{t("pf.notFoundBody")}</p>
          <Link href="/leaderboard" className="mt-6 inline-block">
            <Button variant="ghost">{t("nav.leaderboard")}</Button>
          </Link>
        </Card>
      </main>
    );
  }

  const mine = !!address && !!profile.wallet && address.toLowerCase() === profile.wallet.toLowerCase();
  const shown = positions.filter((p) => (tab === "open" ? p.open : !p.open));

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-14">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{profile.display}</h1>
            <p className="mt-1 font-mono text-sm text-faint">@{profile.handle}</p>
          </div>
          {mine ? <span className="font-mono text-xs text-lime">{t("pf.yours")}</span> : null}
        </div>
        {profile.bio ? <p className="mt-3 max-w-xl text-sm text-muted">{profile.bio}</p> : null}
        {profile.wallet ? (
          <p className="tabular mt-3 font-mono text-xs text-faint">{shortAddress(profile.wallet)}</p>
        ) : null}
      </Card>

      {!profile.wallet ? (
        <Card className="mt-6 p-8 text-center">
          <p className="text-sm text-muted">{t("pf.noWallet")}</p>
        </Card>
      ) : (
        <>
          <Card className="mt-6 p-6">
            <p className={cx("tabular text-4xl font-bold", tone(totals?.netPnl ?? 0))}>
              {totals ? money(totals.netPnl) : "—"}
            </p>
            <p className="eyebrow mt-1">{t("pf.netPnl")}</p>
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label={t("pf.realized")} value={totals ? money(totals.realized) : "—"} cls={tone(totals?.realized ?? 0)} />
              <Stat label={t("pf.unrealized")} value={totals ? money(totals.unrealized) : "—"} cls={tone(totals?.unrealized ?? 0)} />
              <Stat label={t("pf.holding")} value={totals ? formatUsd(totals.value) : "—"} />
              <Stat label={t("pf.volume")} value={totals ? formatUsd(totals.volume) : "—"} />
            </div>
          </Card>

          <div className="mt-6 flex gap-2">
            {(["open", "closed"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cx(
                  "border-2 px-4 py-2 text-xs font-bold uppercase tracking-wide",
                  tab === k ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:border-line-bright",
                )}
              >
                {t(k === "open" ? "pf.open" : "pf.closed")}
              </button>
            ))}
          </div>

          <Card className="mt-3 divide-y-2 divide-line">
            {shown.length === 0 ? (
              <p className="px-5 py-8 text-center font-mono text-sm text-faint">{t("pf.noPositions")}</p>
            ) : (
              shown.map((p) => (
                <Link key={p.token} href={`/token/${p.token}`} className="block px-5 py-3 hover:bg-surface-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="tabular truncate font-mono text-sm text-ink">{shortAddress(p.token)}</span>
                    <span className={cx("tabular text-sm", tone(p.netPnl))}>{money(p.netPnl)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-faint">
                    <span>{t("pf.spent")} {formatUsd(p.cost)}</span>
                    {p.open ? <span>{t("pf.holding")} {formatUsd(p.value)}</span> : null}
                    <span>{t("pf.avgEntry")} ${p.avgEntry < 0.01 ? p.avgEntry.toExponential(2) : p.avgEntry.toFixed(4)}</span>
                    <span>{p.trades}×</span>
                  </div>
                </Link>
              ))
            )}
          </Card>
        </>
      )}
    </main>
  );
}
