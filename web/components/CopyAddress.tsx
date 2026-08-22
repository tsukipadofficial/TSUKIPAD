"use client";

import { useState } from "react";
import { cx } from "./ui";
import { shortAddress } from "@/lib/format";
import { useT } from "@/lib/i18n";

/// A contract address you can actually take with you.
///
/// It was rendered truncated and linked to the explorer, which is fine for
/// looking and useless for the thing people mostly want it for: pasting the
/// address somewhere else. Selecting 0x2165…1A1d gets you the ellipsis.
export function CopyAddress({ address, className }: { address: string; className?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the title attribute still carries the full value */
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={`${address} — ${t("copy.hint")}`}
      className={cx(
        "tabular inline-flex items-center gap-1.5 underline-offset-4 hover:underline",
        copied ? "text-lime" : "text-muted hover:text-lime",
        className,
      )}
    >
      <span>{copied ? t("copy.done") : shortAddress(address)}</span>
      <span aria-hidden className="text-[0.9em] opacity-70">
        {copied ? "✓" : "⧉"}
      </span>
    </button>
  );
}
