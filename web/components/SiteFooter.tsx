"use client";

import { useT } from "@/lib/i18n";
import { X_URL, TELEGRAM_URL } from "@/lib/brand";
import { IS_MAINNET } from "@/lib/config";

/// Official accounts. Rendered from brand.ts so a handle change never means
/// hunting through components.
const SOCIALS = [
  { label: "X", href: X_URL },
  { label: "Telegram", href: TELEGRAM_URL },
];

export function SiteFooter() {
  const t = useT();
  return (
    <footer className="mt-20 border-t-2 border-line px-5 py-8">
      <div className="mx-auto max-w-7xl space-y-3 text-xs text-faint">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="tabular">{t(IS_MAINNET ? "footer.chain.mainnet" : "footer.chain")}</p>
          <div className="flex items-center gap-4">
            {/* The header nav is hidden on phones, so the docs are linked here too, alongside the legal pages. */}
            {[
              { href: "/docs", label: t("nav.docs") },
              { href: "/terms", label: t("nav.terms") },
              { href: "/privacy", label: t("nav.privacy") },
            ].map((l) => (
              <a key={l.href} href={l.href} className="font-bold text-muted transition-colors hover:text-lime">
                {l.label}
              </a>
            ))}
            {SOCIALS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-muted transition-colors hover:text-lime"
              >
                {s.label}
              </a>
            ))}
          </div>
        </div>
        <p className="max-w-xl">{t(IS_MAINNET ? "footer.disclaimer.mainnet" : "footer.disclaimer")}</p>
        {/* Attribution and an explicit non-affiliation line, both required by
            the Arc Brand Guidelines so the relationship cannot read as an
            endorsement. */}
        <div className="space-y-1 border-t-2 border-line pt-3">
          <p>{t("footer.trademark")}</p>
          <p>{t("footer.independent")}</p>
        </div>
      </div>
    </footer>
  );
}
