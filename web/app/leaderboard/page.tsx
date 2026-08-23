"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Avatar } from "@/components/Avatar";
import { Card, cx } from "@/components/ui";
import { ProfileEditor } from "@/components/ProfileEditor";
import { formatUsd, mcap, shortAddress } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type Row = {
  wallet: string; handle: string | null; display: string | null; avatar: string | null;
  netPnl: number; realized: number; unrealized: number; volume: number; positions: number;
};
type Earner = {
  wallet: string; handle: string | null; display: string | null; avatar: string | null;
  earned: number;
};
type Trade = {
  wallet: string; handle: string | null; display: string | null; avatar: string | null;
  token: string; name: string | null; symbol: string | null; image: string | null;
  netPnl: number; spent: number; entryMcap: number | null; open: boolean;
};

const money = (n: number) => `${n >= 0 ? "+" : "-"}${formatUsd(Math.abs(n))}`;
const tone = (n: number) => (n > 0 ? "text-lime" : n < 0 ? "text-pink" : "text-muted");

/// Rank 1-3 are the only ones worth colouring; past that a medal is noise.
const MEDAL = ["text-amber", "text-ink", "text-[#c88b4a]"];

function name(r: { display: string | null; handle: string | null; wallet: string }) {
  return r.display ?? (r.handle ? `@${r.handle}` : shortAddress(r.wallet));
}

/// A row links to a profile only when there is one -- an unclaimed wallet has no
/// page, and a link to a 404 is worse than no link.
function RowLink({
  r, children,
}: {
  r: { handle: string | null }; children: React.ReactNode;
}) {
  const cls = "flex items-center gap-3 px-4 py-3";
  return r.handle ? (
    <Link href={`/u/${r.handle}`} className={cx(cls, "hover:bg-surface-2")}>{children}</Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

export default function LeaderboardPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"pnl" | "earners">("pnl");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [earners, setEarners] = useState<Earner[] | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch("/api/leaderboard", { cache: "no-store" });
        const j = await r.json();
        if (!live || !j.ok) return;
        setRows(j.rows);
        setTrades(j.topTrades ?? []);
      } catch {
        /* the board is a view; a failed refresh leaves the last one up */
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => { live = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (tab !== "earners" || earners !== null) return;
    let live = true;
    (async () => {
      try {
        const r = await fetch("/api/leaderboard?mode=earners", { cache: "no-store" });
        const j = await r.json();
        if (live && j.ok) setEarners(j.rows);
      } catch {
        if (live) setEarners([]);
      }
    })();
    return () => { live = false; };
  }, [tab, earners]);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-14">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("lb.title")}</h1>
      <p className="mt-3 max-w-2xl text-muted">{t("lb.sub")}</p>

      <div className="mt-8">
        <ProfileEditor />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* ---------------- board ---------------- */}
        <div>
          <div className="flex gap-2">
            {(["pnl", "earners"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cx(
                  "border-2 px-4 py-2 text-xs font-bold uppercase tracking-wide",
                  tab === k
                    ? "border-lime bg-lime/10 text-lime"
                    : "border-line text-muted hover:border-line-bright",
                )}
              >
                {t(k === "pnl" ? "lb.tabPnl" : "lb.tabEarners")}
              </button>
            ))}
          </div>

          <Card className="mt-4 divide-y-2 divide-line">
            {tab === "pnl" ? (
              rows === null ? (
                <p className="px-5 py-10 text-center font-mono text-sm text-faint">{t("lb.loading")}</p>
              ) : rows.length === 0 ? (
                <p className="px-5 py-10 text-center font-mono text-sm text-faint">{t("lb.empty")}</p>
              ) : (
                rows.map((r, i) => (
                  <RowLink key={r.wallet} r={r}>
                    <span className={cx("w-6 shrink-0 font-mono text-xs", MEDAL[i] ?? "text-faint")}>
                      {i + 1}
                    </span>
                    <Avatar src={r.avatar} name={name(r)} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold text-ink">{name(r)}</span>
                      <span className="tabular block font-mono text-xs text-faint">
                        {t("lb.positions", { n: String(r.positions) })} ·{" "}
                        {formatUsd(r.volume)}
                      </span>
                    </span>
                    <span className={cx("tabular shrink-0 text-right text-sm font-bold", tone(r.netPnl))}>
                      {money(r.netPnl)}
                    </span>
                  </RowLink>
                ))
              )
            ) : earners === null ? (
              <p className="px-5 py-10 text-center font-mono text-sm text-faint">{t("lb.loading")}</p>
            ) : earners.length === 0 ? (
              <p className="px-5 py-10 text-center font-mono text-sm text-faint">{t("lb.emptyEarners")}</p>
            ) : (
              earners.map((r, i) => (
                <RowLink key={r.wallet} r={r}>
                  <span className={cx("w-6 shrink-0 font-mono text-xs", MEDAL[i] ?? "text-faint")}>
                    {i + 1}
                  </span>
                  <Avatar src={r.avatar} name={name(r)} size={36} />
                  <span className="min-w-0 flex-1 truncate font-bold text-ink">{name(r)}</span>
                  <span className="tabular shrink-0 text-right text-sm font-bold text-lime">
                    {formatUsd(r.earned)}
                  </span>
                </RowLink>
              ))
            )}
          </Card>

          <p className="mt-6 text-xs leading-relaxed text-faint">
            {t(tab === "pnl" ? "lb.note" : "lb.earnersNote")}
          </p>
        </div>

        {/* ---------------- top trades ---------------- */}
        <div>
          <p className="eyebrow mb-4 py-2">{t("lb.topTrades")}</p>
          <Card className="divide-y-2 divide-line">
            {trades.length === 0 ? (
              <p className="px-4 py-8 text-center font-mono text-xs text-faint">{t("lb.empty")}</p>
            ) : (
              trades.map((tr, i) => (
                <Link
                  key={`${tr.wallet}-${tr.token}`}
                  href={`/token/${tr.token}`}
                  className="block px-4 py-3 hover:bg-surface-2"
                >
                  <div className="flex items-center gap-3">
                    <span className={cx("w-6 shrink-0 font-mono text-xs", MEDAL[i] ?? "text-faint")}>
                      #{i + 1}
                    </span>
                    <Avatar src={tr.image} name={tr.symbol ?? tr.token} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-ink">
                        {tr.symbol ? `$${tr.symbol}` : shortAddress(tr.token)}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-faint">
                        {name(tr)}
                      </span>
                    </span>
                    <span className={cx("tabular shrink-0 text-sm font-bold", tone(tr.netPnl))}>
                      {money(tr.netPnl)}
                    </span>
                  </div>
                  <div className="tabular mt-1 flex gap-3 pl-9 font-mono text-[11px] text-faint">
                    <span>{t("pf.spent")} {formatUsd(tr.spent)}</span>
                    {tr.entryMcap ? <span>{t("lb.entry")} {mcap(tr.entryMcap)} {t("lb.mcap")}</span> : null}
                  </div>
                </Link>
              ))
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}
