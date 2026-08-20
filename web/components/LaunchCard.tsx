"use client";

import Link from "next/link";
import type { LaunchView } from "@/lib/hooks";
import { Badge, Card, CurveBar, cx } from "./ui";
import { formatUsd, formatTokenPrice, timeAgo, shortAddress } from "@/lib/format";
import { tickToHumanPrice } from "@/lib/launch-math";
import { decodeMetadata, safeImageUrl } from "@/lib/metadata";
import { useMemo } from "react";
import { useI18n } from "@/lib/i18n";

/// Deterministic identity mark. Tokens have no uploaded art on testnet, so the
/// address itself drives a stable colour pair — recognisable across sessions
/// without any off-chain storage.
export function TokenMark({
  address,
  symbol,
  size = 48,
}: {
  address: string;
  symbol: string;
  size?: number;
}) {
  const seed = parseInt(address.slice(2, 10), 16);
  const hueA = seed % 360;
  const hueB = (hueA + 60 + (seed % 120)) % 360;
  return (
    <div
      className="flex shrink-0 items-center justify-center border-2 border-void font-mono font-bold text-void"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.3,
        background: `linear-gradient(135deg, hsl(${hueA} 90% 62%), hsl(${hueB} 90% 55%))`,
      }}
      aria-hidden
    >
      {symbol.slice(0, 3).toUpperCase()}
    </div>
  );
}

export function LaunchCard({ launch }: { launch: LaunchView }) {
  const { t, lang } = useI18n();
  // Tokens carry their picture on-chain, so the card can show the real artwork
  // rather than the generated fallback mark.
  const image = useMemo(
    () => safeImageUrl(decodeMetadata(launch.metadataURI).image),
    [launch.metadataURI],
  );

  const multiple = launch.marketCapUsd / launch.startMarketCapUsd;
  const isUp = multiple > 1.01;
  const soldOut = launch.curveProgress >= 0.999;
  const fresh = Date.now() / 1000 - Number(launch.createdAt) < 900; // 15 min

  return (
    <Link href={`/token/${launch.token}`} className="block">
      <Card interactive className="h-full p-4">
        <div className="flex items-start gap-3">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt=""
              className="size-12 shrink-0 border-2 border-void object-cover"
            />
          ) : (
            <TokenMark address={launch.token} symbol={launch.symbol} />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-bold leading-tight">
                {launch.name}
              </h3>
              {fresh ? <Badge tone="lime">{t("card.new")}</Badge> : null}
              {soldOut ? <Badge tone="pink">{t("card.soldOut")}</Badge> : null}
              {launch.rewardsEnabled ? <Badge tone="cyan">{t("card.earns")}</Badge> : null}
              {launch.buybackAndBurn ? <Badge tone="pink">{t("card.burns")}</Badge> : null}
              {launch.feeRecipient.toLowerCase() !== launch.creator.toLowerCase() ? (
                <Badge tone="pink">{t("card.funds")}</Badge>
              ) : null}
            </div>
            <p className="tabular text-xs text-muted">
              ${launch.symbol} · {timeAgo(launch.createdAt, lang)}
            </p>
          </div>

          <div className="text-right">
            <p className="tabular text-base font-bold text-lime">
              {formatUsd(launch.marketCapUsd)}
            </p>
            <p
              className={cx(
                "tabular text-xs font-bold",
                isUp ? "text-lime" : "text-muted",
              )}
            >
              {`${multiple.toFixed(multiple >= 10 ? 0 : 1)}×`}
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <CurveBar progress={launch.curveProgress} />
          <div className="flex items-center justify-between text-[0.6875rem] text-faint">
            <span className="tabular">
              {formatTokenPrice(tickToHumanPrice(launch.currentTick))}
            </span>
            {/* Label the bar with the same quantity the bar encodes — supply
                sold. Dollars-remaining lives on the detail page, where there is
                room to explain why the two diverge. */}
            <span className="tabular">
              {soldOut
                ? t("card.soldOut")
                : t("card.supplySold", { pct: formatProgress(launch.curveProgress) })}
            </span>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between border-t-2 border-line pt-3 text-[0.6875rem] text-faint">
          <span className="tabular">{t("card.by", { addr: shortAddress(launch.creator) })}</span>
          <span className="tabular">{t("card.ceiling", { amount: formatUsd(launch.ceilingMarketCapUsd) })}</span>
        </div>
      </Card>
    </Link>
  );
}

/// Early launches sit at a tiny fraction of a percent; rounding them all to "0%"
/// makes every fresh token look identical and dead.
function formatProgress(fraction: number): string {
  const pct = fraction * 100;
  if (pct === 0) return "0%";
  if (pct < 0.1) return "<0.1%";
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(0)}%`;
}
