"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";

import { Button, Card, cx } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { signMessage, normaliseHandle } from "@/lib/waitlist";
import { STORAGE_PREFIX } from "@/lib/brand";

type BoardRow = { rank: number; display: string; clearance: 50 | 100 };
type Board = { total: number; board: BoardRow[]; configured: boolean };

const SAVED = `${STORAGE_PREFIX}:wl:handle`;

/// The bar is the mechanic: a half-filled meter is what makes people finish.
function Meter({ pct }: { pct: number }) {
  return (
    <div className="h-3 w-full border-2 border-line bg-void">
      <div
        className={cx("h-full transition-[width] duration-500", pct === 100 ? "bg-lime" : "bg-cyan")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function WaitlistPage() {
  const { t } = useI18n();
  const { address, isConnected } = useAccount();
  // Privy mints an embedded wallet for email/social users, so step 02 works
  // for someone who has never held a wallet before.
  const { login, ready } = usePrivy();
  const { signMessageAsync } = useSignMessage();

  const [handle, setHandle] = useState("");
  const [claimed, setClaimed] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [rank, setRank] = useState<number | null>(null);
  const [busy, setBusy] = useState<"join" | "sign" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Board>({ total: 0, board: [], configured: true });

  const pct = claimed ? (verified ? 100 : 50) : 0;

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/waitlist", { cache: "no-store" });
      const j = await r.json();
      if (j.ok) setData({ total: j.total, board: j.board, configured: j.configured });
    } catch {
      /* board is decorative; a failed refresh should not break the form */
    }
  }, []);

  useEffect(() => {
    setClaimed(localStorage.getItem(SAVED));
    void refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const msg = (code: string) =>
    ({
      "bad-handle": t("wl.errHandle"),
      "address-taken": t("wl.errTaken"),
      "rate-limited": t("wl.errRate"),
      "waitlist-unavailable": t("wl.unavailable"),
    })[code] ?? t("wl.errGeneric");

  async function post(body: Record<string, unknown>) {
    const r = await fetch("/api/waitlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error ?? "unknown");
    return j as { handle: string; clearance: 50 | 100; rank: number | null };
  }

  async function join() {
    setError(null);
    const h = normaliseHandle(handle);
    if (!h) return setError(t("wl.errHandle"));
    setBusy("join");
    try {
      const j = await post({ handle: h });
      localStorage.setItem(SAVED, j.handle);
      setClaimed(j.handle);
      setRank(j.rank);
      void refresh();
    } catch (e) {
      setError(msg((e as Error).message));
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    if (!claimed || !address) return;
    setError(null);
    setBusy("sign");
    try {
      const signature = await signMessageAsync({
        message: signMessage(claimed, address),
      });
      const j = await post({ handle: claimed, address, signature });
      setVerified(j.clearance === 100);
      setRank(j.rank);
      void refresh();
    } catch (e) {
      const m = (e as Error).message;
      // A user rejecting the wallet prompt is not an error worth shouting about.
      if (!/reject|denied|User rejected/i.test(m)) setError(msg(m));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-14">
      <div className="inline-flex items-center gap-2 border-2 border-line bg-surface px-3 py-1.5">
        <span className="size-2 animate-pulse-dot bg-lime" />
        <span className="font-mono text-xs text-muted">{t("wl.badge")}</span>
      </div>

      <h1 className="mt-6 text-5xl font-bold tracking-tight sm:text-6xl">{t("wl.title")}</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">{t("wl.sub")}</p>

      {/* clearance ------------------------------------------------------ */}
      <Card className="mt-10 p-6">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-xs tracking-wide text-faint">
            {t("wl.clearance")}
          </span>
          <span className={cx("font-mono text-2xl font-bold", pct === 100 ? "text-lime" : "text-ink")}>
            {pct}%
          </span>
        </div>
        <div className="mt-3">
          <Meter pct={pct} />
        </div>
        {claimed && rank !== null && (
          <p className="mt-3 font-mono text-sm text-lime">
            {t("wl.you", { rank: String(rank), total: String(data.total) })}
          </p>
        )}
      </Card>

      {/* steps ---------------------------------------------------------- */}
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-cyan">01</span>
            <h2 className="text-xl font-bold">{t("wl.step1")}</h2>
            {claimed && <span className="ml-auto font-mono text-xs text-lime">✓</span>}
          </div>
          <p className="mt-2 text-sm text-muted">{t("wl.step1b")}</p>
          {claimed ? (
            <p className="mt-4 font-mono text-2xl font-bold text-ink">@{claimed}</p>
          ) : (
            <div className="mt-4 flex gap-2">
              <div className="flex flex-1 items-center border-2 border-line bg-void px-3">
                <span className="font-mono text-muted">@</span>
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void join()}
                  placeholder={t("wl.placeholder")}
                  maxLength={15}
                  spellCheck={false}
                  className="w-full bg-transparent px-1 py-2.5 font-mono text-ink outline-none placeholder:text-faint"
                />
              </div>
              <Button onClick={() => void join()} disabled={busy !== null}>
                {busy === "join" ? t("wl.joining") : t("wl.join")}
              </Button>
            </div>
          )}
        </Card>

        <Card className={cx("p-6", !claimed && "opacity-50")}>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-lime">02</span>
            <h2 className="text-xl font-bold">{t("wl.step2")}</h2>
            {verified && <span className="ml-auto font-mono text-xs text-lime">✓</span>}
          </div>
          <p className="mt-2 text-sm text-muted">{t("wl.step2b")}</p>
          <div className="mt-4">
            {!isConnected ? (
              <Button variant="ghost" disabled={!claimed || !ready} onClick={() => login()}>
                {t("wl.connectFirst")}
              </Button>
            ) : verified ? (
              <p className="font-mono text-sm text-lime">
                {address?.slice(0, 6)}…{address?.slice(-4)}
              </p>
            ) : (
              <Button disabled={!claimed || busy !== null} onClick={() => void verify()}>
                {busy === "sign" ? t("wl.signing") : t("wl.sign")}
              </Button>
            )}
          </div>
        </Card>
      </div>

      {error && (
        <p className="mt-4 border-2 border-pink bg-surface px-4 py-3 font-mono text-sm text-pink">
          {error}
        </p>
      )}
      {!data.configured && (
        <p className="mt-4 border-2 border-amber bg-surface px-4 py-3 font-mono text-sm text-amber">
          {t("wl.unavailable")}
        </p>
      )}

      {/* board ---------------------------------------------------------- */}
      <div className="mt-14 flex items-baseline justify-between">
        <h2 className="text-2xl font-bold">{t("wl.board")}</h2>
        <span className="font-mono text-sm text-muted">
          {t("wl.total", { n: String(data.total) })}
        </span>
      </div>
      <Card className="mt-4 divide-y-2 divide-line">
        {data.board.length === 0 ? (
          <p className="px-5 py-8 text-center font-mono text-sm text-faint">{t("wl.empty")}</p>
        ) : (
          data.board.map((r) => (
            <div key={r.rank} className="flex items-center gap-4 px-5 py-2.5">
              <span className="w-10 shrink-0 font-mono text-xs text-faint">{r.rank}</span>
              <span className="flex-1 truncate font-mono text-sm text-ink">@{r.display}</span>
              <span
                className={cx(
                  "font-mono text-xs",
                  r.clearance === 100 ? "text-lime" : "text-faint",
                )}
              >
                {r.clearance}%
              </span>
            </div>
          ))
        )}
      </Card>

      {/* why ------------------------------------------------------------ */}
      <h2 className="mt-14 text-2xl font-bold">{t("wl.why")}</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {[t("wl.why1"), t("wl.why2"), t("wl.why3")].map((w, i) => (
          <li key={i} className="border-2 border-line bg-surface p-5 text-sm text-muted">
            {w}
          </li>
        ))}
      </ul>

      <p className="mt-10 font-mono text-xs leading-relaxed text-faint">{t("wl.safe")}</p>
    </main>
  );
}
