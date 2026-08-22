"use client";

import { useMemo } from "react";
import { useReadContract } from "wagmi";
import Link from "next/link";
import { zeroAddress, zeroHash } from "viem";
import type { Address } from "viem";

import { Badge, Button, Card, CurveBar, LiveDot, Skeleton, Stat, cx } from "./ui";
import { CurvePreview } from "./CurvePreview";
import { TokenMark } from "./LaunchCard";
import { TradePanel } from "./TradePanel";
import { RewardsPanel } from "./RewardsPanel";
import { CreatorLockPanel } from "./CreatorLockPanel";
import { BurnPanel } from "./BurnPanel";
import { FeesPanel } from "./FeesPanel";
import { CopyAddress } from "./CopyAddress";
import { useLaunch } from "@/lib/hooks";
import { useTrades } from "@/lib/useTrades";
import { EXPLORER_URL, LAUNCHPAD_ADDRESS, isDeployed } from "@/lib/config";
import { launchpadAbi } from "@/lib/abi";
import { formatUsd, formatTokenPrice, shortAddress, timeAgo } from "@/lib/format";
import { tickToHumanPrice } from "@/lib/launch-math";
import { decodeMetadata, safeImageUrl, beneficiaryLink, telegramUrl } from "@/lib/metadata";
import { useI18n } from "@/lib/i18n";

export function TokenView({ token }: { token: Address }) {
  const { t, lang } = useI18n();
  const { launch, isLoading, notFound, error } = useLaunch(token);

  // What the escrow is holding. Without this the page showed uncollected fees
  // going to zero after a collection and said nothing about where they went,
  // which reads exactly like the earmarked money disappearing.
  const { data: escrowed } = useReadContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    functionName: "escrowUsdc",
    args: [token],
    query: { enabled: isDeployed, refetchInterval: 30_000 },
  });
  // Whether the launch earmarked its fees for a social account. Without this the
  // page cannot tell a *claimed earmark* (fees now flow to the handle's proven
  // wallet) from a *redirect* (creator deliberately gave the fees away) -- both
  // have feeRecipient != creator, and the page was calling the first one the
  // second, telling every visitor "the creator takes nothing from this launch"
  // about a launch whose creator had just claimed it.
  const { data: commitment } = useReadContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    functionName: "recipientCommitment",
    args: [token],
    query: { enabled: isDeployed, refetchInterval: 60_000 },
  });

  const { trades, isLoading: tradesLoading } = useTrades(launch?.pool);

  const meta = useMemo(
    () => decodeMetadata(launch?.metadataURI ?? ""),
    [launch?.metadataURI],
  );
  const image = safeImageUrl(meta.image);

  if (!isDeployed) {
    return (
      <Wrapper>
        <Card className="p-8 text-center">
          <p className="font-bold text-amber">{t("token.notConfigured")}</p>
        </Card>
      </Wrapper>
    );
  }

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

  // A failed read is not the same claim as "this token was never launched
  // here". Saying the latter when we mean the former is the worse mistake.
  if (!notFound && (error || !launch)) {
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

  if (notFound || !launch) {
    return (
      <Wrapper>
        <Card className="p-12 text-center">
          <p className="text-2xl font-bold">{t("token.notFound")}</p>
          <p className="mt-2 text-sm text-muted">
            {t("token.notFound.body", { addr: shortAddress(token) })}
          </p>
          <Link href="/" className="mt-6 inline-block">
            <Button>{t("token.back")}</Button>
          </Link>
        </Card>
      </Wrapper>
    );
  }

  // A launch that named a social account carries a non-zero commitment for its
  // whole life -- claiming does not clear it. That makes the commitment the only
  // reliable way to tell the three fee destinations apart.
  // Until the read lands the launch's category is genuinely unknown, and
  // guessing prints "the creator takes nothing from this launch" for a frame on
  // every page load. Both panels stay hidden rather than flash the wrong one.
  const commitmentKnown = commitment !== undefined;
  const wasEarmarked = commitmentKnown && commitment !== zeroHash;

  // An earmarked launch has no recipient at all until somebody proves the
  // account is theirs, so its recipient is the zero address by construction.
  const earmarked = launch.feeRecipient === zeroAddress;

  // The earmark has been claimed: fees now flow to the wallet the named account
  // proved it controls. This is the creator being paid, not the creator giving
  // the money away, so it must not borrow the redirect copy.
  const claimedEarmark = wasEarmarked && !earmarked;

  // A launch is genuinely "redirected" when the launcher chose to send fees to
  // some other address outright. An earmark is not that -- neither before it is
  // claimed (0x0000…0000 is not a destination) nor after (the recipient is the
  // named account itself).
  const redirected =
    commitmentKnown &&
    !earmarked &&
    !wasEarmarked &&
    launch.feeRecipient.toLowerCase() !== launch.creator.toLowerCase();
  const funds = beneficiaryLink(meta.fundsLabel);

  const allocationLocked =
    launch.creatorAllocation > 0n &&
    !launch.allocationClaimed &&
    Date.now() / 1000 < Number(launch.unlockAt);

  const price = tickToHumanPrice(launch.currentTick);
  const multiple = launch.marketCapUsd / launch.startMarketCapUsd;
  const soldOut = launch.curveProgress >= 0.999;

  return (
    <Wrapper>
      {/* ---------------- header ---------------- */}
      <header className="mb-6 flex flex-wrap items-start gap-4">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            className="size-16 shrink-0 border-2 border-line object-cover"
          />
        ) : (
          <TokenMark address={launch.token} symbol={launch.symbol} size={64} />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {launch.name}
            </h1>
            <span className="tabular text-lg text-muted">${launch.symbol}</span>
            {soldOut ? <Badge tone="pink">{t("card.soldOut")}</Badge> : null}
            <Badge tone="lime">
              <LiveDot /> {t("token.liquidityLocked")}
            </Badge>
            {launch.rewardsEnabled ? <Badge tone="cyan">{t("token.holdersEarn")}</Badge> : null}
            {launch.buybackAndBurn ? <Badge tone="pink">{t("token.deflationary")}</Badge> : null}
            {redirected ? <Badge tone="pink">{t("token.feesFund")}</Badge> : null}
            {allocationLocked ? <Badge tone="cyan">{t("token.creatorLocked")}</Badge> : null}
          </div>

          {meta.description ? (
            <p className="mt-2 max-w-2xl text-sm text-muted">{meta.description}</p>
          ) : null}

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
            <span className="text-faint">·</span>
            <a
              href={`${EXPLORER_URL}/address/${launch.pool}`}
              target="_blank"
              rel="noreferrer"
              className="text-muted underline-offset-4 hover:text-cyan hover:underline"
            >
              pool
            </a>
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
          <p className="tabular text-3xl font-bold text-lime">
            {formatUsd(launch.marketCapUsd)}
          </p>
          <p className="tabular text-sm text-muted">
            {t("token.fromLaunch", { n: multiple.toFixed(multiple >= 10 ? 0 : 2) })}
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        {/* ---------------- left ---------------- */}
        <div className="space-y-6">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="eyebrow">{t("token.priceCurve")}</p>
              <span className="tabular text-xs text-muted">
                {t("token.supplySold", { pct: `${(launch.curveProgress * 100).toFixed(1)}%` })}
              </span>
            </div>

            <CurvePreview
              startTick={launch.tickLower}
              endTick={launch.tickUpper}
              startMcap={launch.startMarketCapUsd}
              ceilingMcap={launch.ceilingMarketCapUsd}
              progress={launch.curveProgress}
              capacityUsd={launch.remainingCapacityUsd}
            />

            <CurveBar progress={launch.curveProgress} className="mt-4" />

            <div className="mt-5 grid grid-cols-2 gap-5 border-t-2 border-line pt-4 sm:grid-cols-4">
              <Stat label={t("token.price")} value={formatTokenPrice(price)} accent="lime" />
              <Stat label={t("token.marketCap")} value={formatUsd(launch.marketCapUsd)} />
              <Stat
                label={t("token.leftToFill")}
                value={soldOut ? "—" : formatUsd(launch.remainingCapacityUsd)}
                accent="cyan"
              />
              <Stat label={t("token.ceiling")} value={formatUsd(launch.ceilingMarketCapUsd)} />
            </div>

            <p className="mt-4 border-t-2 border-line pt-4 text-xs leading-relaxed text-muted">
              {t("token.curveExplain", {
                pct: `${(launch.curveProgress * 100).toFixed(1)}%`,
                amount: formatUsd(launch.remainingCapacityUsd),
              })}
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
              <p className="py-8 text-center text-sm text-muted">
                {t("token.noTrades")}
              </p>
            ) : (
              <ul className="divide-y-2 divide-line">
                {/* Named `trade` rather than `t` so it does not shadow the
                    translate function from the i18n hook. */}
                {trades.map((trade) => (
                  <li
                    key={trade.id}
                    className="animate-rise flex items-center justify-between py-2.5 text-sm"
                  >
                    <span
                      className={cx(
                        "text-xs font-bold uppercase",
                        trade.side === "buy" ? "text-lime" : "text-pink",
                      )}
                    >
                      {trade.side === "buy" ? t("token.buy") : t("token.sell")}
                    </span>
                    <span className="tabular text-muted">
                      {trade.tokens.toLocaleString("en-US", { maximumFractionDigits: 0 })}{" "}
                      {launch.symbol}
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
              <Fact term={t("facts.tax")} detail={t("facts.tax.v")} />
              <Fact
                term={t("facts.liquidity")}
                detail={t("facts.liquidity.v")}
              />
              <Fact term={t("facts.creator")} detail={shortAddress(launch.creator)} />
              <Fact
                term={t("facts.metadata")}
                detail={
                  meta.image?.startsWith("data:")
                    ? t("facts.metadata.img")
                    : t("facts.metadata.plain")
                }
              />
              <Fact
                term={t("facts.fees")}
                detail={
                  launch.buybackAndBurn
                    ? t("facts.fees.burn")
                    : launch.rewardsEnabled
                      ? t("facts.fees.holders")
                      : earmarked
                        // `redirected` excludes earmarks, so this branch fell
                        // through to "collected by the creator" -- the one
                        // thing an earmarked launch definitely does not do.
                        ? t("facts.fees.earmarked")
                        : claimedEarmark
                          ? t("facts.fees.claimed", { addr: shortAddress(launch.feeRecipient) })
                          : redirected
                          ? t("facts.fees.redirect", { addr: shortAddress(launch.feeRecipient) })
                          : t("facts.fees.creator")
                }
              />
            </dl>
          </Card>
        </div>

        {/* ---------------- right ---------------- */}
        <div className="space-y-4 lg:sticky lg:top-24">
          <TradePanel launch={launch} />

          <FeesPanel launch={launch} />

          <RewardsPanel launch={launch} />

          <BurnPanel launch={launch} />

          <CreatorLockPanel launch={launch} />

          {/* A launch whose fees are earmarked has no recipient until somebody
              proves the account is theirs, so a zero recipient is the signal. */}
          {earmarked ? (
            <Card className="border-cyan p-4">
              <p className="eyebrow mb-2 text-cyan">{t("token.earmarked")}</p>
              <p className="tabular text-3xl font-bold text-cyan">
                {formatUsd(Number((escrowed as bigint | undefined) ?? 0n) / 1e6)}
              </p>
              <p className="eyebrow mb-3 mt-1">{t("token.earmarkedHeld")}</p>
              <p className="text-sm leading-relaxed text-muted">{t("token.earmarkedBody")}</p>
              <Link href="/claim" className="mt-3 inline-block">
                <Button variant="ghost" size="sm">{t("token.earmarkedCta")}</Button>
              </Link>
            </Card>
          ) : null}

          {/* A claimed earmark gets its own panel. It is the opposite of a
              redirect -- the named account proved a wallet and is now being paid
              -- so it is deliberately lime rather than pink. */}
          {claimedEarmark ? (
            <Card className="border-lime p-4">
              <p className="eyebrow mb-2 text-lime">{t("claimed.title")}</p>
              <p className="text-xs leading-relaxed text-muted">{t("claimed.body")}</p>
              <a
                href={`${EXPLORER_URL}/address/${launch.feeRecipient}`}
                target="_blank"
                rel="noreferrer"
                className="tabular mt-2 block text-sm font-bold text-lime underline-offset-4 hover:underline"
              >
                {shortAddress(launch.feeRecipient)}
              </a>
              {funds ? (
                <p className="mt-2 text-xs text-muted">
                  {t("claimed.by", { target: funds.text })}
                </p>
              ) : null}
            </Card>
          ) : null}

          {redirected ? (
            <Card className="border-pink p-4">
              <p className="eyebrow mb-2">{t("redirect.title")}</p>
              <p className="text-xs leading-relaxed text-muted">
                {t("redirect.body")}
              </p>
              <a
                href={`${EXPLORER_URL}/address/${launch.feeRecipient}`}
                target="_blank"
                rel="noreferrer"
                className="tabular mt-2 block text-sm font-bold text-pink underline-offset-4 hover:underline"
              >
                {shortAddress(launch.feeRecipient)}
              </a>
              {funds ? (
                <div className="mt-2 text-xs text-muted">
                  {funds.href ? (
                    <a
                      href={funds.href}
                      target="_blank"
                      rel="noreferrer"
                      className="font-bold text-ink underline-offset-4 hover:text-cyan hover:underline"
                    >
                      {funds.text}
                    </a>
                  ) : (
                    <span className="font-bold text-ink">{funds.text}</span>
                  )}
                  <p className="mt-1">{t("redirect.claimed", { target: funds.text })}</p>
                </div>
              ) : null}
            </Card>
          ) : null}

          <Card className="p-4">
            <p className="eyebrow mb-2">{t("rug.title")}</p>
            <p className="text-xs leading-relaxed text-muted">
              {t("rug.body")}
            </p>
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
