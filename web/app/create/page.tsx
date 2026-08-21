"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseUnits, decodeEventLog, isAddress, zeroAddress, type Address, type Hex } from "viem";
import {
  useAccount,
  usePublicClient,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { EMPTY_COMMITMENT, storedReferrer } from "@/lib/referral";

import { Badge, Button, Card, Stat, cx } from "@/components/ui";
import { CurvePreview } from "@/components/CurvePreview";
import { ImagePicker } from "@/components/ImagePicker";
import { launchpadAbi } from "@/lib/abi";
import {
  LAUNCHPAD_ADDRESS,
  TOKEN_DECIMALS,
  DEFAULT_SUPPLY,
  DEFAULT_START_MCAP_USD,
  DEFAULT_CEILING_MULTIPLE,
  isDeployed,
  chain,
} from "@/lib/config";
import {
  startTickForMarketCap,
  ceilingTick,
  marketCapAtTick,
  curveCapacityUsd,
  mineSalt,
  tickToHumanPrice,
} from "@/lib/launch-math";
import { encodeMetadata, beneficiaryLink } from "@/lib/metadata";
import { formatUsd, formatTokenPrice } from "@/lib/format";
import { useT } from "@/lib/i18n";

/// Ceiling multiples offered on the form. The top option exists so a launch can
/// price a path to a billion-dollar cap without the pool selling out first —
/// all of these stay comfortably inside Uniswap's tick bounds.
const CEILING_OPTIONS = [1_000, 10_000, 100_000];

export default function CreatePage() {
  const t = useT();
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");

  const [startMcap, setStartMcap] = useState(DEFAULT_START_MCAP_USD);
  const [ceilingMultiple, setCeilingMultiple] = useState(DEFAULT_CEILING_MULTIPLE);
  const [allocationPct, setAllocationPct] = useState(0);
  /// Where the creator's half of swap fees goes. Immutable once launched, so
  /// this is surfaced as an explicit choice rather than a buried setting.
  const [feeMode, setFeeMode] = useState<"creator" | "holders" | "redirect" | "burn">("creator");
  const [feeRecipientInput, setFeeRecipientInput] = useState("");
  const [fundsLabel, setFundsLabel] = useState("");

  const rewardHolders = feeMode === "holders";
  const redirecting = feeMode === "redirect";
  const burning = feeMode === "burn";
  const recipientValid = !redirecting || isAddress(feeRecipientInput.trim());

  const [mining, setMining] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supply = DEFAULT_SUPPLY;

  // --- derived economics -------------------------------------------------
  const { tickLower, tickUpper, startActual, ceilingActual, capacity, openPrice } =
    useMemo(() => {
      const lower = startTickForMarketCap(startMcap, supply);
      const upper = ceilingTick(lower, ceilingMultiple);
      return {
        tickLower: lower,
        tickUpper: upper,
        startActual: marketCapAtTick(lower, supply),
        ceilingActual: marketCapAtTick(upper, supply),
        capacity: curveCapacityUsd(lower, upper, supply),
        openPrice: tickToHumanPrice(lower),
      };
    }, [startMcap, ceilingMultiple, supply]);

  const metadataURI = useMemo(
    () =>
      encodeMetadata({
        description,
        image,
        twitter,
        telegram,
        fundsLabel: redirecting ? fundsLabel : "",
      }),
    [description, image, twitter, telegram, redirecting, fundsLabel],
  );

  const totalSupplyWei = parseUnits(supply.toString(), TOKEN_DECIMALS);

  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<Hex | undefined>();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  // On confirmation, pull the token address straight out of the Launched event.
  useEffect(() => {
    if (!receipt.data) return;
    for (const log of receipt.data.logs) {
      try {
        const parsed = decodeEventLog({
          abi: launchpadAbi,
          data: log.data,
          topics: log.topics,
        });
        if (parsed.eventName === "Launched") {
          const token = (parsed.args as { token: Address }).token;
          router.push(`/token/${token}`);
          return;
        }
      } catch {
        // Not our event; keep scanning.
      }
    }
  }, [receipt.data, router]);

  const nameOk = name.trim().length >= 2 && name.trim().length <= 32;
  const symbolOk = /^[A-Z0-9]{2,10}$/.test(symbol.trim().toUpperCase());
  const wrongChain = isConnected && chainId !== chain.id;
  const canSubmit =
    isDeployed &&
    isConnected &&
    !wrongChain &&
    nameOk &&
    symbolOk &&
    recipientValid &&
    !mining &&
    !txHash;

  async function handleLaunch() {
    if (!address || !publicClient) return;
    setError(null);
    setMining(true);
    try {
      const cleanName = name.trim();
      const cleanSymbol = symbol.trim().toUpperCase();

      // The token must sort below USDC to become token0. Ask the contract for
      // the exact init-code hash so mining matches what CREATE2 will produce.
      setStatus(t("status.hashing"));
      const initCodeHash = (await publicClient.readContract({
        address: LAUNCHPAD_ADDRESS,
        abi: launchpadAbi,
        functionName: "tokenInitCodeHash",
        args: [address, cleanName, cleanSymbol, totalSupplyWei, metadataURI, rewardHolders],
      })) as Hex;

      setStatus(t("status.mining"));
      const { salt, token, attempts } = mineSalt(LAUNCHPAD_ADDRESS, address, initCodeHash);
      setStatus(t("status.found", { addr: token.slice(0, 10), n: attempts }));

      const hash = await writeContractAsync({
        address: LAUNCHPAD_ADDRESS,
        abi: launchpadAbi,
        functionName: "launch",
        args: [
          {
            name: cleanName,
            symbol: cleanSymbol,
            metadataURI,
            totalSupply: totalSupplyWei,
            salt,
            tickLower,
            tickUpper,
            creatorAllocationBps: Math.round(allocationPct * 100),
            rewardHolders,
            feeRecipient: redirecting
              ? (feeRecipientInput.trim() as Address)
              : zeroAddress,
            buybackAndBurn: burning,
            // Earmarking fees for an identity is not wired into this form yet;
            // a launch made here always names a concrete recipient or nobody.
            recipientCommitment: EMPTY_COMMITMENT,
            // Carried from ?ref= if the creator arrived through someone's link.
            referrer: storedReferrer(),
          },
        ],
      });
      setTxHash(hash);
      setStatus(t("status.launching"));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Launch failed.";
      setError(message.split("\n")[0]);
      setStatus(null);
    } finally {
      setMining(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {t("create.title")}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          {t("create.subtitle")}{" "}
          <span className="font-bold text-lime">{t("create.subtitle.bold")}</span>
          {t("create.subtitle.end")}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        {/* ---------------- form ---------------- */}
        <Card className="p-5">
          <div className="space-y-5">
            <Field label={t("field.name")} hint={t("field.name.hint")}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Arc Doge"
                maxLength={32}
                className={inputCx(name === "" || nameOk)}
              />
            </Field>

            <Field label={t("field.ticker")} hint={t("field.ticker.hint")}>
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="ADOGE"
                maxLength={10}
                className={cx(inputCx(symbol === "" || symbolOk), "tabular")}
              />
            </Field>

            <Field label={t("field.description")} optional>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder={t("field.description.ph")}
                className={cx(inputCx(true), "resize-none")}
              />
            </Field>

            <Field label={t("field.picture")} optional>
              <ImagePicker value={image} onChange={setImage} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="X / Twitter" optional>
                <input
                  value={twitter}
                  onChange={(e) => setTwitter(e.target.value)}
                  placeholder="@handle"
                  className={inputCx(true)}
                />
              </Field>
              <Field label={t("field.telegram")} optional>
                <input
                  value={telegram}
                  onChange={(e) => setTelegram(e.target.value)}
                  placeholder="t.me/yourchat"
                  className={inputCx(true)}
                />
              </Field>
            </div>

            <hr className="border-line" />

            <Field
              label={t("field.openingMcap")}
              hint={t("field.openingMcap.hint")}
            >
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1_000}
                  max={10_000}
                  step={500}
                  value={startMcap}
                  onChange={(e) => setStartMcap(Number(e.target.value))}
                  className="h-2 flex-1 cursor-pointer appearance-none bg-line accent-lime"
                />
                <span className="tabular w-20 text-right text-lg font-bold text-lime">
                  {formatUsd(startActual)}
                </span>
              </div>
            </Field>

            <Field
              label={t("field.ceiling")}
              hint={t("field.ceiling.hint")}
            >
              <div className="flex gap-2">
                {CEILING_OPTIONS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setCeilingMultiple(m)}
                    className={cx(
                      "flex-1 border-2 px-3 py-2 text-sm font-bold transition-colors",
                      ceilingMultiple === m
                        ? "border-lime bg-lime text-void"
                        : "border-line text-muted hover:border-line-bright hover:text-ink",
                    )}
                  >
                    {m >= 1_000_000
                      ? `${m / 1_000_000}M×`
                      : m >= 1_000
                        ? `${m / 1_000}K×`
                        : `${m}×`}
                  </button>
                ))}
              </div>
            </Field>

            <div>
              <span className="eyebrow mb-1.5 block">{t("field.fees")}</span>
              <div className="space-y-2">
                {[
                  {
                    id: "creator" as const,
                    titleKey: "fees.creator.t" as const,
                    bodyKey: "fees.creator.b" as const,
                  },
                  {
                    id: "holders" as const,
                    titleKey: "fees.holders.t" as const,
                    bodyKey: "fees.holders.b" as const,
                  },
                  {
                    id: "burn" as const,
                    titleKey: "fees.burn.t" as const,
                    bodyKey: "fees.burn.b" as const,
                  },
                  {
                    id: "redirect" as const,
                    titleKey: "fees.redirect.t" as const,
                    bodyKey: "fees.redirect.b" as const,
                  },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setFeeMode(opt.id)}
                    className={cx(
                      "block w-full border-2 p-3 text-left transition-colors",
                      feeMode === opt.id
                        ? "border-lime bg-lime/10"
                        : "border-line hover:border-line-bright",
                    )}
                  >
                    <span
                      className={cx(
                        "block text-sm font-bold",
                        feeMode === opt.id ? "text-lime" : "text-ink",
                      )}
                    >
                      {t(opt.titleKey)}
                    </span>
                    <span className="mt-1 block text-xs leading-snug text-muted">
                      {t(opt.bodyKey)}
                    </span>
                  </button>
                ))}
              </div>

              {redirecting ? (
                <div className="mt-3 space-y-3 border-2 border-line p-3">
                  <Field label={t("field.recipient")} hint={t("field.recipient.hint")}>
                    <input
                      value={feeRecipientInput}
                      onChange={(e) => setFeeRecipientInput(e.target.value)}
                      placeholder="0x…"
                      className={cx(
                        inputCx(feeRecipientInput === "" || recipientValid),
                        "tabular",
                      )}
                    />
                  </Field>
                  <Field
                    label={t("field.funds")}
                    optional
                    hint={t("field.funds.hint")}
                  >
                    <input
                      value={fundsLabel}
                      onChange={(e) => setFundsLabel(e.target.value)}
                      placeholder="@handle or owner/repo"
                      className={inputCx(true)}
                    />
                  </Field>
                  <p className="text-xs leading-relaxed text-amber">
                    {t("field.funds.warning")}
                  </p>
                </div>
              ) : null}
            </div>

            <Field
              label={t("field.allocation", { pct: allocationPct })}
              hint={
                allocationPct === 0
                  ? t("field.allocation.none")
                  : t("field.allocation.some", {
                      amount: (Number(supply) * allocationPct) / 100 / 1e6,
                    })
              }
            >
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={allocationPct}
                onChange={(e) => setAllocationPct(Number(e.target.value))}
                className={cx(
                  "h-2 w-full cursor-pointer appearance-none bg-line",
                  allocationPct > 10 ? "accent-pink" : "accent-lime",
                )}
              />
            </Field>
          </div>
        </Card>

        {/* ---------------- preview ---------------- */}
        <div className="space-y-4 lg:sticky lg:top-24">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="eyebrow">{t("preview.title")}</p>
              <Badge tone="cyan">Uniswap V3 · 1% fee</Badge>
            </div>

            <CurvePreview
              startTick={tickLower}
              endTick={tickUpper}
              startMcap={startActual}
              ceilingMcap={ceilingActual}
              capacityUsd={capacity}
            />

            <div className="mt-5 grid grid-cols-2 gap-4 border-t-2 border-line pt-4">
              <Stat label={t("preview.opensAt")} value={formatUsd(startActual)} accent="lime" />
              <Stat label={t("preview.ceiling")} value={formatUsd(ceilingActual)} accent="cyan" />
              <Stat
                label={t("preview.openingPrice")}
                value={formatTokenPrice(openPrice)}
                sub={t("preview.supply", { n: supply.toLocaleString() })}
              />
              <Stat
                label={t("preview.fillsCurve")}
                value={formatUsd(capacity)}
                sub={t("preview.fillsCurve.sub")}
              />
            </div>

            <div className="mt-4 flex items-start gap-2 border-t-2 border-line pt-4">
              <Badge tone={feeMode === "creator" ? "line" : "lime"}>
                {feeMode === "creator"
                  ? t("preview.badge.creator")
                  : feeMode === "holders"
                    ? t("preview.badge.holders")
                    : feeMode === "burn"
                      ? t("preview.badge.burn")
                      : t("preview.badge.funds")}
              </Badge>
              <span className="text-xs leading-relaxed text-muted">
                {feeMode === "creator"
                  ? t("preview.badge.creator.b")
                  : feeMode === "holders"
                    ? t("preview.badge.holders.b")
                    : feeMode === "burn"
                      ? t("preview.badge.burn.b")
                      : t("preview.badge.funds.b", {
                        target:
                          beneficiaryLink(fundsLabel)?.text ??
                          t("preview.badge.funds.fallback"),
                      })}
              </span>
            </div>

            <p className="mt-4 border-t-2 border-line pt-4 text-xs leading-relaxed text-muted">
              {t("preview.explain", {
                amount: formatUsd(capacity),
                start: formatUsd(startActual),
              })}
            </p>
          </Card>

          <Card className="p-5">
            <p className="eyebrow mb-3">{t("cost.title")}</p>
            <div className="flex items-baseline gap-2">
              <span className="tabular text-3xl font-bold text-lime">$0</span>
              <span className="text-sm text-muted">{t("cost.gas")}</span>
            </div>
            <p className="mt-2 text-xs text-muted">
              {t("cost.body")}
            </p>
          </Card>

          {error ? (
            <Card className="border-pink p-4">
              <p className="text-sm font-bold text-pink">{error}</p>
            </Card>
          ) : null}

          {status && !error ? (
            <Card className="border-cyan p-4">
              <p className="tabular text-sm text-cyan">{status}</p>
            </Card>
          ) : null}

          <Button
            size="lg"
            className="w-full"
            disabled={!canSubmit}
            onClick={handleLaunch}
          >
            {!isDeployed
              ? t("cta.notDeployed")
              : !isConnected
                ? t("cta.connect")
                : wrongChain
                  ? t("cta.switchNetwork")
                  : mining || receipt.isLoading
                    ? t("cta.working")
                    : t("cta.launch")}
          </Button>

          {!nameOk && name !== "" ? (
            <p className="text-xs text-pink">{t("err.nameLength")}</p>
          ) : null}
          {!symbolOk && symbol !== "" ? (
            <p className="text-xs text-pink">
              {t("err.ticker")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-2">
        <span className="eyebrow">{label}</span>
        {optional ? (
          <span className="text-[0.625rem] text-faint">{t("field.optional")}</span>
        ) : null}
      </span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

function inputCx(valid: boolean): string {
  return cx(
    "w-full border-2 bg-void px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none",
    valid ? "border-line focus:border-lime" : "border-pink",
  );
}
