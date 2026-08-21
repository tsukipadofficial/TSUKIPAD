/// Renders the zero-run in a tiny price as a subscript count, the convention
/// every token screener uses (e.g. $0.0₅3021).
function subscript(n: number): string {
  const glyphs = "₀₁₂₃₄₅₆₇₈₉";
  return String(n).split("").map((d) => glyphs[Number(d)]).join("");
}

export function usd(v: number): string {
  if (!Number.isFinite(v)) return "$0";
  if (v === 0) return "$0";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  // Screener convention: count the leading zeros rather than printing them.
  const exp = Math.floor(Math.log10(v));
  const zeros = Math.abs(exp) - 1;
  const digits = Math.round(v * 10 ** (zeros + 3));
  return `$0.0${subscript(zeros)}${digits}`;
}

export function short(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function ago(ts: bigint): string {
  const s = Math.floor(Date.now() / 1000) - Number(ts);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function countdown(unlockAt: bigint): string | null {
  const s = Number(unlockAt) - Math.floor(Date.now() / 1000);
  if (s <= 0) return null;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}
