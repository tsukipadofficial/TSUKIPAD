import Link from "next/link";
import type { ReactNode } from "react";

/// Shared frame for the Terms and Privacy pages: one readable column, a date the
/// reader can check, and the same section rhythm as the docs.
export function LegalPage({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-14">
      <header className="border-b-2 border-line pb-8">
        <p className="eyebrow mb-4">Last updated {updated}</p>
        <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">{title}</h1>
        <div className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">{intro}</div>
        <nav className="mt-6 flex flex-wrap gap-2 text-xs" aria-label="Legal">
          <Link href="/terms" className="border-2 border-line px-2.5 py-1 text-muted hover:border-lime hover:text-ink">
            Terms of Use
          </Link>
          <Link href="/privacy" className="border-2 border-line px-2.5 py-1 text-muted hover:border-lime hover:text-ink">
            Privacy Policy
          </Link>
          <Link href="/docs" className="border-2 border-line px-2.5 py-1 text-muted hover:border-lime hover:text-ink">
            Docs
          </Link>
        </nav>
      </header>
      {children}
    </main>
  );
}

export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 pt-10">
      <h2 className="mb-3 text-xl font-bold tracking-tight text-balance sm:text-2xl">{title}</h2>
      <div className="space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-2.5 h-1.5 w-1.5 shrink-0 bg-lime" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
