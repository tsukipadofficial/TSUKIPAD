"use client";

import { useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Address } from "viem";

import { Badge, Button, Card, CurveBar, LiveDot, Skeleton, Stat, cx } from "./ui";
import { TokenMark } from "./LaunchCard";
import { TradePanel } from "./TradePanel";
import { CurveTradePanel } from "./CurveTradePanel";
import { CurveFeesPanel } from "./CurveFeesPanel";
import { RewardsPanel } from "./RewardsPanel";
import { CopyAddress } from "./CopyAddress";
import { openingMarketCapUsd, useCurveLaunch } from "@/lib/curve";
import { useTrades } from "@/lib/useTrades";
import { EXPLORER_URL } from "@/lib/config";
import { formatUsd, formatTokenPrice, shortAddress, timeAgo } from "@/lib/format";
import { decodeMetadata, safeImageUrl, telegramUrl } from "@/lib/metadata";
import { useI18n } from "@/lib/i18n";

// lightweight-charts touches the DOM, so it loads in the browser only.
const PriceChart = dynamic(() => import("./PriceChart").then((m) => m.PriceChart), { ssr: false });

/// Token page for a bonding-curve launch, before and after it graduates.
export function CurveTokenView({ token }: { token: Address }) {
  const { t, lang } = useI18n();
  const { launch, config, isLoading, error, refetch } = useCurveLaunch(token);
  const graduated = !!launch?.curve?.graduated;
  const { trades, isLoading: tradesLoading } = useTrades(graduated ? launch?.pool : undefined, token);

  const meta = useMemo(() => decodeMetadata(launch?.metadataURI ?? ""), [launch?.metadataURI]);
  const image = safeImageUrl(meta.image);

  if (isLoading) {
    return (
      <Wrapper>
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Skeleton className="h-96 border-2 border-line" />
          <Skeleton className="h-96 border-2 border-line" />
        </div>
      </Wrapper>
    );
  }

  if (error || !launch || !launch.curve || !config) {
    return (
      <Wrapper>
        <Card className="p-12 text-center">
          <p className="text-2xl font-bold text-amber">{t("token.loadFailed")}</p>
          <p className="mt-2 text-sm text-muted">{t("token.loadFailedBody")}</p>
          <Link href="/" className="mt-6 inline-block">
            <Button variant="ghost">{t("token.back")}</Button>
          </Link>
        </Card>
      </Wrapper>
    );
  }

  const c = launch.curve;
  const multiple = launch.marketCapUsd / launch.startMarketCapUsd;
  const totalFeeBps = config.tradeFeeBps + c.creatorTaxBps;
  // The recipient's cut of a curve trade: their share of the base fee plus the whole creator tax.
  const yoursBps = (config.tradeFeeBps * (10_000 - config.protocolFeeBps)) / 10_000 + c.creatorTaxBps;
  const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
  const recipient = launch.rewardsEnabled ? t("curve.fees.holders") : shortAddress(launch.feeRecipient);

  return (
    <Wrapper>
      {/* ---------------- header ---------------- */}
      <header className="mb-6 flex flex-wrap items-start gap-4">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="size-16 shrink-0 border-2 border-line object-cover" />
        ) : (
          <TokenMark address={launch.token} symbol={launch.symbol} size={64} />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{launch.name}</h1>
            <span className="tabular text-lg text-muted">${launch.symbol}</span>
            {graduated ? (
              <Badge tone="lime">
                <LiveDot /> {t("curve.graduated")}
              </Badge>
            ) : (
              <Badge tone="cyan">{t("curve.badge")}</Badge>
            )}
            {launch.rewardsEnabled ? <Badge tone="cyan">{t("token.holdersEarn")}</Badge> : null}
          </div>

          {meta.description ? <p className="mt-2 max-w-2xl text-sm text-muted">{meta.description}</p> : null}

          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <CopyAddress address={launch.token} />
            <a
              href={`${EXPLORER_URL}/address/${launch.token}`}
              target="_blank"
              rel="noreferrer"
              className="text-faint underline-offset-4 hover:text-lime hover:underline"
            >
              {t("token.explorer")}
            </a>
            {graduated ? (
              <>
                <span className="text-faint">·</span>
                <a
                  href={`${EXPLORER_URL}/address/${launch.pool}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted underline-offset-4 hover:text-cyan hover:underline"
                >
                  pool
                </a>
              </>
            ) : null}
            {meta.website ? (
              <>
                <span className="text-faint">·</span>
                <a
                  href={meta.website.startsWith("http") ? meta.website : `https://${meta.website}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted underline-offset-4 hover:text-cyan hover:underline"
                >
                  website
                </a>
              </>
            ) : null}
            {meta.twitter ? (
              <>
                <span className="text-faint">·</span>
                <a
                  href={`https://x.com/${meta.twitter.replace(/^@/, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted underline-offset-4 hover:text-cyan hover:underline"
                >
                  {meta.twitter}
                </a>
              </>
            ) : null}
            {meta.telegram ? (
              <>
                <span className="text-faint">·</span>
                <a
                  href={telegramUrl(meta.telegram)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted underline-offset-4 hover:text-cyan hover:underline"
                >
                  telegram
                </a>
              </>
            ) : null}
            <span className="text-faint">·</span>
            <span className="text-faint">{t("token.launchedAgo", { t: timeAgo(launch.createdAt, lang) })}</span>
          </div>
        </div>

        <div className="text-right">
          <p className="tabular text-3xl font-bold text-lime">{formatUsd(launch.marketCapUsd)}</p>
          <p className="tabular text-sm text-muted">
            {t("token.fromLaunch", { n: multiple.toFixed(multiple >= 10 ? 0 : 2) })}
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        {/* ---------------- left ---------------- */}
        <div className="space-y-6">
          {/* One chart across the whole life of the token: curve trades first,
              then the Uniswap pool once it graduates. */}
          <Card className="p-5">
            <p className="eyebrow mb-3">{t("token.chartTab")}</p>
            <PriceChart token={token} openingMcap={config ? openingMarketCapUsd(config) : undefined} />
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="eyebrow">{t("curve.progress")}</p>
              <span className="tabular text-xs font-bold text-lime">
                {graduated ? "100%" : `${(launch.curveProgress * 100).toFixed(launch.curveProgress < 0.1 ? 2 : 1)}%`}
              </span>
            </div>

            <CurveBar progress={launch.curveProgress} />
            <p className="tabular mt-2 text-xs text-muted">
              {t("curve.raised", {
                raised: formatUsd(graduated ? c.goalUsd : c.raisedUsd, { compact: false }),
                goal: formatUsd(c.goalUsd, { compact: false }),
              })}
            </p>

            <div className="mt-5 grid grid-cols-2 gap-5 border-t-2 border-line pt-4 sm:grid-cols-4">
              <Stat label={t("token.price")} value={formatTokenPrice(launch.priceUsd)} accent="lime" />
              <Stat label={t("token.marketCap")} value={formatUsd(launch.marketCapUsd)} />
              <Stat
                label={t("curve.toGo")}
                value={graduated ? "—" : formatUsd(launch.remainingCapacityUsd)}
                accent="cyan"
              />
              <Stat label={t("curve.graduatesAt")} value={formatUsd(c.graduationMcapUsd)} />
            </div>

            <p className="mt-4 border-t-2 border-line pt-4 text-xs leading-relaxed text-muted">
              {graduated
                ? t("curve.graduatedExplain")
                : t("curve.explain", { goal: formatUsd(c.goalUsd, { compact: false }) })}
            </p>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <p className="eyebrow">{t("token.liveTrades")}</p>
              <LiveDot />
            </div>
            {tradesLoading ? (
              <p className="py-8 text-center text-sm text-muted">{t("token.tradesLoading")}</p>
            ) : trades.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">{t("token.noTrades")}</p>
            ) : (
              <ul className="divide-y-2 divide-line">
                {trades.map((trade) => (
                  <li key={trade.id} className="animate-rise flex items-center justify-between py-2.5 text-sm">
                    <span
                      className={cx(
                        "text-xs font-bold uppercase",
                        trade.side === "buy" ? "text-lime" : "text-pink",
                      )}
                    >
                      {trade.side === "buy" ? t("token.buy") : t("token.sell")}
                    </span>
                    <span className="tabular text-muted">
                      {trade.tokens.toLocaleString("en-US", { maximumFractionDigits: 0 })} {launch.symbol}
                    </span>
                    <span className="tabular font-bold">
                      ${trade.usdc.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </span>
                    <a
                      href={`${EXPLORER_URL}/address/${trade.who}`}
                      target="_blank"
                      rel="noreferrer"
                      className="tabular text-xs text-faint hover:text-cyan"
                    >
                      {shortAddress(trade.who)}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <p className="eyebrow mb-4">{t("facts.title")}</p>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Fact term={t("facts.supply")} detail={`${launch.supplyWhole.toLocaleString()} ${launch.symbol}`} />
              <Fact term={t("facts.mint")} detail={t("facts.mint.v")} />
              <Fact term={t("facts.owner")} detail={t("facts.owner.v")} />
              <Fact
                term={t("facts.transfers")}
                detail={graduated ? t("facts.transfers.open") : t("facts.transfers.locked")}
              />
              <Fact
                term={t("facts.graduation")}
                detail={t("curve.pv.graduation.v", {
                  goal: formatUsd(c.goalUsd, { compact: false }),
                  mcap: formatUsd(c.graduationMcapUsd),
                })}
              />
              <Fact term={t("facts.liquidity")} detail={t("facts.liquidity.v")} />
              <Fact
                term={t("facts.fees")}
                detail={t("facts.fees.curve", { total: pct(totalFeeBps), yours: pct(yoursBps), to: recipient })}
              />
              <Fact term={t("facts.creator")} detail={shortAddress(launch.creator)} />
            </dl>
          </Card>
        </div>

        {/* ---------------- right ---------------- */}
        <div className="space-y-4 lg:sticky lg:top-24">
          {graduated ? <TradePanel launch={launch} /> : <CurveTradePanel launch={launch} onTraded={refetch} />}
          <CurveFeesPanel launch={launch} />
          <RewardsPanel launch={launch} />
          <Card className="p-4">
            <p className="eyebrow mb-2">{t("rug.title")}</p>
            <p className="text-xs leading-relaxed text-muted">{t("rug.body")}</p>
          </Card>
        </div>
      </div>
    </Wrapper>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-5 py-8">{children}</div>;
}

function Fact({ term, detail }: { term: string; detail: string }) {
  return (
    <div>
      <dt className="eyebrow">{term}</dt>
      <dd className="tabular mt-1 text-sm">{detail}</dd>
    </div>
  );
}
