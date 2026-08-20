/// Display helpers. Everything a trader scans quickly — market caps, prices,
/// balances — goes through here so rounding stays consistent across the app.

export function formatUsd(value: number, opts?: { compact?: boolean }): string {
  if (!Number.isFinite(value)) return "$0";
  if (opts?.compact !== false && Math.abs(value) >= 1_000) {
    return `$${compactNumber(value)}`;
  }
  if (Math.abs(value) < 0.01 && value !== 0) return `$${value.toPrecision(2)}`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = value / size;
      return `${scaled.toFixed(scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)}${suffix}`;
    }
  }
  return value.toFixed(abs >= 1 ? 0 : 2);
}

/// Sub-cent token prices need significant digits, not fixed decimals: a launch
/// price of $0.0000030 is meaningless rendered as "$0.00".
export function formatTokenPrice(usd: number): string {
  if (!Number.isFinite(usd) || usd === 0) return "$0";
  if (usd >= 0.01) return `$${usd.toFixed(4)}`;
  const exponent = Math.floor(Math.log10(usd));
  const leadingZeros = Math.abs(exponent) - 1;
  const digits = Math.round(usd * 10 ** (leadingZeros + 3));
  return `$0.0${subscript(leadingZeros)}${digits}`;
}

/// Renders the zero-run in a tiny price as a subscript count, the convention
/// used by most token screeners (e.g. $0.0₅3021).
function subscript(n: number): string {
  const glyphs = "₀₁₂₃₄₅₆₇₈₉";
  return String(n)
    .split("")
    .map((d) => glyphs[Number(d)])
    .join("");
}

export function formatUnitsFloat(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function timeAgo(timestampSeconds: number | bigint, lang: "en" | "ja" = "en"): string {
  const then = Number(timestampSeconds) * 1000;
  const delta = Math.max(0, Date.now() - then);
  const mins = Math.floor(delta / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (lang === "ja") {
    if (mins < 1) return "たった今";
    if (mins < 60) return `${mins}分前`;
    if (hours < 24) return `${hours}時間前`;
    return `${days}日前`;
  }
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export function percent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(value >= 100 || value <= -100 ? 0 : 1)}%`;
}

/// Countdown to a future unix timestamp, e.g. "12m 04s".
export function countdown(toSeconds: number | bigint, lang: "en" | "ja" = "en"): string {
  const remaining = Number(toSeconds) * 1000 - Date.now();
  if (remaining <= 0) return lang === "ja" ? "解除済" : "unlocked";
  const mins = Math.floor(remaining / 60_000);
  const secs = Math.floor((remaining % 60_000) / 1000);
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}
