"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Card, cx } from "@/components/ui";
import { ProfileEditor } from "@/components/ProfileEditor";
import { formatUsd, shortAddress } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type Row = {
  wallet: string; handle: string | null; display: string | null;
  netPnl: number; realized: number; unrealized: number; volume: number; positions: number;
};

const money = (n: number) => `${n >= 0 ? "+" : "-"}${formatUsd(Math.abs(n))}`;

export default function LeaderboardPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [sort, setSort] = useState<"netPnl" | "volume">("netPnl");

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch("/api/leaderboard", { cache: "no-store" });
        const j = await r.json();
        if (live && j.ok) setRows(j.rows);
      } catch {
        /* the board is a view; a failed refresh leaves the last one up */
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => { live = false; clearInterval(id); };
  }, []);

  const sorted = rows ? [...rows].sort((a, b) => b[sort] - a[sort]) : null;

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-14">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t("lb.title")}</h1>
      <p className="mt-3 max-w-2xl text-muted">{t("lb.sub")}</p>

      <div className="mt-8">
        <ProfileEditor />
      </div>

      <div className="mt-8 flex gap-2">
        {(["netPnl", "volume"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setSort(k)}
            className={cx(
              "border-2 px-4 py-2 text-xs font-bold uppercase tracking-wide",
              sort === k ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:border-line-bright",
            )}
          >
            {t(k === "netPnl" ? "lb.byPnl" : "lb.byVolume")}
          </button>
        ))}
      </div>

      <Card className="mt-4 divide-y-2 divide-line">
        {sorted === null ? (
          <p className="px-5 py-10 text-center font-mono text-sm text-faint">{t("lb.loading")}</p>
        ) : sorted.length === 0 ? (
          <p className="px-5 py-10 text-center font-mono text-sm text-faint">{t("lb.empty")}</p>
        ) : (
          sorted.map((r, i) => {
            const body = (
              <>
                <span className="w-8 shrink-0 font-mono text-xs text-faint">{i + 1}</span>
                <span className="flex-1 truncate">
                  <span className="font-bold text-ink">
                    {r.display ?? r.handle ?? shortAddress(r.wallet)}
                  </span>
                  {r.handle ? <span className="ml-2 font-mono text-xs text-faint">@{r.handle}</span> : null}
                </span>
                <span className="tabular hidden text-xs text-muted sm:inline">
                  {t("lb.positions", { n: String(r.positions) })}
                </span>
                <span className={cx("tabular w-28 text-right text-sm", r[sort] >= 0 ? "text-lime" : "text-pink")}>
                  {sort === "volume" ? formatUsd(r.volume) : money(r.netPnl)}
                </span>
              </>
            );
            return r.handle ? (
              <Link key={r.wallet} href={`/u/${r.handle}`} className="flex items-center gap-4 px-5 py-3 hover:bg-surface-2">
                {body}
              </Link>
            ) : (
              <div key={r.wallet} className="flex items-center gap-4 px-5 py-3">{body}</div>
            );
          })
        )}
      </Card>

      <p className="mt-6 text-xs leading-relaxed text-faint">{t("lb.note")}</p>
    </main>
  );
}
