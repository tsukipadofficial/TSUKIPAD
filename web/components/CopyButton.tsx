"use client";

import { useState } from "react";

import { useT } from "@/lib/i18n";

/// A plain "Copy" button for a value already shown in full beside it, as on the
/// docs page's contract list. `CopyAddress` is the inline, truncated variant.
export function CopyButton({ value }: { value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the full value is visible and selectable beside it */
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="shrink-0 justify-self-start border-2 border-line px-2 py-1 text-[0.625rem] font-bold uppercase tracking-wider text-muted transition-colors hover:border-lime hover:text-lime"
    >
      {copied ? t("copy.done") : "Copy"}
    </button>
  );
}
