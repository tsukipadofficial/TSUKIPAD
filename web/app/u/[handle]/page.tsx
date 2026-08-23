"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";

import { Avatar } from "@/components/Avatar";
import { Button, Card, cx } from "@/components/ui";
import { CopyAddress } from "@/components/CopyAddress";
import { formatUsd, mcap, shortAddress } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type Profile = {
  handle: string; display: string; bio: string;
  avatar: string | null; wallet: string | null; createdAt: number;
};
type Pos = {
  token: string; name: string | null; symbol: string | null; image: string | null;
  value: number; cost: number; spent: number; realized: number; unrealized: number;
  netPnl: number; avgEntry: number; entryMcap: number | null; marketCap: number | null;
  trades: number; open: boolean;
};
type Totals = {
  netPnl: number; realized: number; unrealized: number;
  volume: number; value: number; spent: number; earned: number;
};

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
  const { t, lang } = useI18n();
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
  const best = positions.length > 0 ? positions[0] : null;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-14">
      {/* ---------------- header ---------------- */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start gap-5">
          <Avatar src={profile.avatar} name={profile.display} size={84} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{profile.display}</h1>
              {mine ? <span className="font-mono text-xs text-lime">{t("pf.yours")}</span> : null}
            </div>
            <p className="mt-1 font-mono text-sm text-faint">@{profile.handle}</p>
            {profile.bio ? <p className="mt-3 max-w-xl text-sm text-muted">{profile.bio}</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-4 font-mono text-xs text-faint">
              {profile.wallet ? <CopyAddress address={profile.wallet} /> : null}
              {profile.createdAt ? (
                <span>
                  {t("pf.since", {
                    d: new Date(profile.createdAt).toLocaleDateString(
                      lang === "ja" ? "ja-JP" : "en-US",
                      { year: "numeric", month: "short", day: "numeric" },
                    ),
                  })}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {!profile.wallet ? (
        <Card className="mt-6 p-8 text-center">
          <p className="text-sm text-muted">{t("pf.noWallet")}</p>
        </Card>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            {/* ---------------- totals ---------------- */}
            <Card className="p-6">
              <p className={cx("tabular text-4xl font-bold", tone(totals?.netPnl ?? 0))}>
                {totals ? money(totals.netPnl) : "—"}
              </p>
              <p className="eyebrow mt-1">{t("pf.netPnl")}</p>
              <div className="mt-5 grid grid-cols-2 gap-4 border-t-2 border-line pt-4 sm:grid-cols-4">
                <Stat label={t("pf.realized")} value={totals ? money(totals.realized) : "—"} cls={tone(totals?.realized ?? 0)} />
                <Stat label={t("pf.unrealized")} value={totals ? money(totals.unrealized) : "—"} cls={tone(totals?.unrealized ?? 0)} />
                <Stat label={t("pf.holding")} value={totals ? formatUsd(totals.value) : "—"} />
                <Stat label={t("pf.volume")} value={totals ? formatUsd(totals.volume) : "—"} />
              </div>
              {totals && totals.earned > 0 ? (
                <div className="mt-4 border-t-2 border-line pt-4">
                  {/* Fee income is not a trading result, so it is shown apart
                      from PNL rather than folded into it. */}
                  <Stat label={t("pf.earned")} value={formatUsd(totals.earned)} cls="text-lime" />
                </div>
              ) : null}
            </Card>

            {/* ---------------- positions ---------------- */}
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
                  <Link key={p.token} href={`/token/${p.token}`} className="block px-4 py-3 hover:bg-surface-2">
                    <div className="flex items-center gap-3">
                      <Avatar src={p.image} name={p.symbol ?? p.token} size={38} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-bold text-ink">
                          {p.symbol ? `$${p.symbol}` : shortAddress(p.token)}
                        </span>
                        <span className="block truncate font-mono text-xs text-faint">
                          {p.name ?? shortAddress(p.token)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={cx("tabular block text-sm font-bold", tone(p.netPnl))}>
                          {money(p.netPnl)}
                        </span>
                        <span className="tabular block font-mono text-[11px] text-faint">
                          {p.open ? formatUsd(p.value) : formatUsd(p.spent)}
                        </span>
                      </span>
                    </div>
                    <div className="tabular mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-[50px] font-mono text-[11px] text-faint">
                      <span>{t("pf.spent")} {formatUsd(p.spent)}</span>
                      {/* Entry as market cap, which is how this market talks
                          about entries -- a price here reads $0.0₅303. */}
                      {p.entryMcap ? <span>{t("lb.entry")} {mcap(p.entryMcap)} {t("lb.mcap")}</span> : null}
                      <span>{p.trades}×</span>
                    </div>
                  </Link>
                ))
              )}
            </Card>
          </div>

          {/* ---------------- best trade ---------------- */}
          <div>
            {best ? (
              <>
                <p className="eyebrow mb-4 py-2">{t("pf.topTrade")}</p>
                <Card className="p-5">
                  <div className="flex items-center gap-3">
                    <Avatar src={best.image} name={best.symbol ?? best.token} size={44} />
                    <div className="min-w-0">
                      <p className="truncate font-bold text-ink">
                        {best.symbol ? `$${best.symbol}` : shortAddress(best.token)}
                      </p>
                      <p className="truncate font-mono text-xs text-faint">{best.name ?? ""}</p>
                    </div>
                  </div>
                  <p className={cx("tabular mt-4 text-3xl font-bold", tone(best.netPnl))}>
                    {money(best.netPnl)}
                  </p>
                  <div className="tabular mt-3 space-y-1 font-mono text-xs text-faint">
                    <p>{t("pf.spent")} {formatUsd(best.spent)}</p>
                    {best.entryMcap ? <p>{t("lb.entry")} {mcap(best.entryMcap)} {t("lb.mcap")}</p> : null}
                    {best.marketCap ? <p>{t("lb.mcap")} {mcap(best.marketCap)}</p> : null}
                  </div>
                </Card>
              </>
            ) : null}
          </div>
        </div>
      )}
    </main>
  );
}
