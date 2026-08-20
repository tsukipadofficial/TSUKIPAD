"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { LaunchCard } from "@/components/LaunchCard";
import { Badge, Button, Card, LiveDot, Skeleton, cx } from "@/components/ui";
import { useLaunches } from "@/lib/hooks";
import { isDeployed, EXPLORER_URL } from "@/lib/config";
import { formatUsd } from "@/lib/format";
import { useT } from "@/lib/i18n";

type Sort = "new" | "mcap" | "climbing";

const SORTS = [
  { id: "new" as const, key: "board.sort.new" as const },
  { id: "mcap" as const, key: "board.sort.mcap" as const },
  { id: "climbing" as const, key: "board.sort.climbing" as const },
];

export default function BoardPage() {
  const t = useT();
  const { launches, isLoading, error } = useLaunches();
  const [sort, setSort] = useState<Sort>("new");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? launches.filter(
          (l) =>
            l.name.toLowerCase().includes(q) ||
            l.symbol.toLowerCase().includes(q) ||
            l.token.toLowerCase().includes(q),
        )
      : launches;

    const sorted = [...filtered];
    if (sort === "new") sorted.sort((a, b) => Number(b.createdAt - a.createdAt));
    if (sort === "mcap") sorted.sort((a, b) => b.marketCapUsd - a.marketCapUsd);
    if (sort === "climbing") {
      sorted.sort(
        (a, b) =>
          b.marketCapUsd / b.startMarketCapUsd - a.marketCapUsd / a.startMarketCapUsd,
      );
    }
    return sorted;
  }, [launches, sort, query]);

  const totalCap = launches.reduce((sum, l) => sum + l.marketCapUsd, 0);

  return (
    <div>
      <Hero count={launches.length} totalCap={totalCap} />

      {launches.length > 0 ? <Ticker launches={launches} /> : null}

      <section className="mx-auto max-w-7xl px-5 py-10">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            {SORTS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSort(s.id)}
                className={cx(
                  "border-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors",
                  sort === s.id
                    ? "border-lime bg-lime text-void"
                    : "border-line text-muted hover:border-line-bright hover:text-ink",
                )}
              >
                {t(s.key)}
              </button>
            ))}
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("board.search")}
            className="tabular ml-auto w-full max-w-xs border-2 border-line bg-surface px-3 py-1.5 text-sm placeholder:text-faint focus:border-lime focus:outline-none"
          />
        </div>

        {!isDeployed ? (
          <NotDeployed />
        ) : error ? (
          <Card className="p-8 text-center">
            <p className="font-bold text-pink">{t("board.error.title")}</p>
            <p className="mt-1 text-sm text-muted">{t("board.error.body")}</p>
          </Card>
        ) : isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 border-2 border-line" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState hasQuery={!!query} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((l, i) => (
              <div
                key={l.token}
                className="animate-rise"
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
              >
                <LaunchCard launch={l} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Hero({ count, totalCap }: { count: number; totalCap: number }) {
  const t = useT();
  return (
    <section className="border-b-2 border-line">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-14 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div>
          <div className="mb-4 flex items-center gap-2">
            <Badge tone="lime">
              <LiveDot /> {t("hero.badge.testnet")}
            </Badge>
            <Badge tone="cyan">Uniswap V3</Badge>
          </div>

          <h1 className="text-4xl font-bold leading-[0.95] tracking-tight sm:text-6xl">
            {t("hero.title.1")} <span className="text-lime">$3K</span>
            <br />
            {t("hero.title.2")} <span className="text-cyan">{t("hero.title.3")}</span>
            <br />
            {t("hero.title.4")}
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">
            {t("hero.body")}{" "}
            <span className="font-bold text-ink">{t("hero.body.bold")}</span>
            {t("hero.body.end")}
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/create">
              <Button size="lg">{t("hero.cta")}</Button>
            </Link>
            <a href={`${EXPLORER_URL}`} target="_blank" rel="noreferrer">
              <Button size="lg" variant="ghost">
                {t("nav.explorer")}
              </Button>
            </a>
          </div>
        </div>

        <Card className="p-5">
          <p className="eyebrow mb-4">{t("how.title")}</p>
          <ol className="space-y-3.5 text-sm">
            {([
              ["how.1.t", "how.1.b"],
              ["how.2.t", "how.2.b"],
              ["how.3.t", "how.3.b"],
              ["how.4.t", "how.4.b"],
            ] as const).map(([titleKey, bodyKey], i) => (
              <li key={titleKey} className="flex gap-3">
                <span className="tabular flex size-6 shrink-0 items-center justify-center border-2 border-lime text-xs font-bold text-lime">
                  {i + 1}
                </span>
                <span>
                  <span className="font-bold">{t(titleKey)}</span>{" "}
                  <span className="text-muted">{t(bodyKey)}</span>
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-5 grid grid-cols-2 gap-4 border-t-2 border-line pt-4">
            <div>
              <p className="eyebrow">{t("stats.launches")}</p>
              <p className="tabular text-2xl font-bold">{count}</p>
            </div>
            <div>
              <p className="eyebrow">{t("stats.combinedCap")}</p>
              <p className="tabular text-2xl font-bold text-lime">
                {formatUsd(totalCap)}
              </p>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}

/// Scrolling tape of live launches. Duplicated once so the marquee loop is seamless.
function Ticker({ launches }: { launches: ReturnType<typeof useLaunches>["launches"] }) {
  const items = [...launches, ...launches];
  return (
    <div className="overflow-hidden border-b-2 border-line bg-surface py-2">
      <div className="flex w-max animate-marquee gap-8">
        {items.map((l, i) => {
          const mult = l.marketCapUsd / l.startMarketCapUsd;
          return (
            <span key={`${l.token}-${i}`} className="tabular flex items-center gap-2 text-xs">
              <span className="font-bold">${l.symbol}</span>
              <span className="text-muted">{formatUsd(l.marketCapUsd)}</span>
              <span className={mult > 1.01 ? "text-lime" : "text-faint"}>
                {mult.toFixed(1)}×
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function NotDeployed() {
  return (
    <Card className="p-8">
      <h2 className="text-xl font-bold text-amber">Contracts not configured</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        The frontend has no launchpad address yet. Deploy the contracts, then put the
        addresses in <code className="tabular text-ink">web/.env.local</code>:
      </p>
      <pre className="tabular mt-4 overflow-x-auto border-2 border-line bg-void p-4 text-xs text-lime">
{`cd contracts
PRIVATE_KEY=0xyour_testnet_key \\
  forge script script/Deploy.s.sol:Deploy \\
  --rpc-url arc_testnet --broadcast

# then copy the printed addresses into web/.env.local
NEXT_PUBLIC_LAUNCHPAD_ADDRESS=0x...
NEXT_PUBLIC_SWAP_ROUTER_ADDRESS=0x...`}
      </pre>
    </Card>
  );
}

function EmptyState({ hasQuery }: { hasQuery: boolean }) {
  const t = useT();
  return (
    <Card className="p-12 text-center">
      <p className="text-2xl font-bold">
        {hasQuery ? t("board.noMatch.title") : t("board.empty.title")}
      </p>
      <p className="mt-2 text-sm text-muted">
        {hasQuery ? t("board.noMatch.body") : t("board.empty.body")}
      </p>
      {!hasQuery ? (
        <Link href="/create" className="mt-6 inline-block">
          <Button size="lg">{t("board.empty.cta")}</Button>
        </Link>
      ) : null}
    </Card>
  );
}
