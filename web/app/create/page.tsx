"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { parseUnits, decodeEventLog, isAddress, zeroAddress, type Address, type Hex } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { EMPTY_COMMITMENT, accountReferrer } from "@/lib/referral";
import { PROVIDERS, commitmentFor, labelFor, type Provider } from "@/lib/commitment";

import { Badge, Button, Card, cx } from "@/components/ui";
import { ImagePicker } from "@/components/ImagePicker";
import { curveAbi, erc20Abi, launchpadAbi } from "@/lib/abi";
import {
  useCurveConfig,
  openingMarketCapUsd,
  graduationMarketCapUsd,
  grossToGraduateUsd,
} from "@/lib/curve";
import {
  CURVE_ADDRESS,
  LAUNCHPAD_ADDRESS,
  USDC_ADDRESS,
  USDC_DECIMALS,
  TOKEN_DECIMALS,
  DEFAULT_SUPPLY,
  DEFAULT_START_MCAP_USD,
  DEFAULT_CEILING_MULTIPLE,
  MAX_CREATOR_TAX_BPS,
  IS_MAINNET,
  isDeployed,
  isCurveDeployed,
  chain,
  TOKEN_DEPLOYER_ADDRESS,
  POOL_FEE,
} from "@/lib/config";
import {
  startTickForMarketCap,
  ceilingTick,
  marketCapAtTick,
  mineSalt,
} from "@/lib/launch-math";
import { encodeMetadata, beneficiaryLink } from "@/lib/metadata";
import { formatUsd, formatUnitsFloat } from "@/lib/format";
import { useT } from "@/lib/i18n";


/// Mine a launch address, then make sure nothing already lives there.
///
/// The search starts from a random salt, so a collision should never happen;
/// this is the belt to that pair of braces. An occupied address would make the
/// launch revert after the creator had already paid for it, so it is checked
/// here, for free, and mined again.
async function mineFreshSalt(
  client: { getCode: (a: { address: Address }) => Promise<Hex | undefined> },
  creator: Address,
  initCodeHash: Hex,
): Promise<{ salt: Hex; token: Address; attempts: number; vanity: boolean }> {
  for (let tries = 0; tries < 3; tries++) {
    const found = mineSalt(TOKEN_DEPLOYER_ADDRESS, creator, initCodeHash);
    const code = await client.getCode({ address: found.token });
    if (!code || code === "0x") return found;
  }
  throw new Error("could not find a free token address");
}

export default function CreatePage() {
  const t = useT();
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const { getAccessToken } = usePrivy();
  const publicClient = usePublicClient();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");

  /// Where the creator's half of swap fees goes. Immutable once launched, so
  /// this is surfaced as an explicit choice rather than a buried setting.
  const [feeMode, setFeeMode] = useState<"creator" | "holders" | "redirect" | "burn">("creator");
  const [feeRecipientInput, setFeeRecipientInput] = useState("");
  // A redirect can name a wallet, or earmark an identity that has none yet.
  const [recipientKind, setRecipientKind] = useState<"wallet" | "identity">("wallet");
  const [provider, setProvider] = useState<Provider>("x");
  const [identityHandle, setIdentityHandle] = useState("");
  const [fundsLabel, setFundsLabel] = useState("");

  const rewardHolders = feeMode === "holders";
  const redirecting = feeMode === "redirect";
  const burning = feeMode === "burn";
  const earmarking = redirecting && recipientKind === "identity";
  const commitment = earmarking ? commitmentFor(provider, identityHandle) : null;
  const recipientValid =
    !redirecting || (earmarking ? commitment !== null : isAddress(feeRecipientInput.trim()));

  /// A curve launch trades on the bonding curve until it graduates; a direct
  /// launch opens straight into a pool. The curve is the default because it is
  /// what most people arriving from other launchpads expect.
  const [launchType, setLaunchType] = useState<"curve" | "direct">(
    isCurveDeployed ? "curve" : "direct",
  );
  const onCurve = launchType === "curve" && isCurveDeployed;
  const curveConfig = useCurveConfig();
  const [devBuy, setDevBuy] = useState("");
  const [curveHolders, setCurveHolders] = useState(false);
  const [curveWallet, setCurveWallet] = useState("");
  const [creatorTaxPct, setCreatorTaxPct] = useState(0);
  const [exempt, setExempt] = useState<Address[]>([]);
  const [exemptDraft, setExemptDraft] = useState("");
  const [advanced, setAdvanced] = useState(false);

  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && onCurve, refetchInterval: 20_000 },
  });
  const usdcFloat = formatUnitsFloat((usdcBalance as bigint | undefined) ?? 0n, USDC_DECIMALS);

  // What share of trading fees the creator keeps. Read from whichever contract
  // this launch will use, never hardcoded: it is fixed at deployment, and a
  // redeploy that changed it would otherwise leave the form quoting the old one.
  const { data: padProtocolBps } = useReadContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    functionName: "protocolFeeBps",
    query: { enabled: isDeployed && !onCurve },
  });
  const devBuyWei = useMemo(() => {
    const trimmed = devBuy.trim();
    if (!trimmed || Number.isNaN(Number(trimmed))) return 0n;
    try {
      return parseUnits(trimmed, USDC_DECIMALS);
    } catch {
      return 0n;
    }
  }, [devBuy]);
  const devBuyOk = usdcBalance === undefined || devBuyWei <= (usdcBalance as bigint);
  const curveWalletValid = curveWallet.trim() === "" || isAddress(curveWallet.trim());
  const creatorTaxBps = Math.round(creatorTaxPct * 100);
  // The hook rejects anything above MAX_CREATOR_TAX_BPS, so a form that lets a
  // number through above it is only selling somebody a reverted launch and the
  // gas it cost. A direct launch has no curve config to read, so the ceiling
  // comes from the same constant the hook enforces.
  const maxTaxBps = onCurve ? (curveConfig?.maxCreatorTaxBps ?? MAX_CREATOR_TAX_BPS) : MAX_CREATOR_TAX_BPS;
  const creatorTaxOk = creatorTaxBps >= 0 && creatorTaxBps <= maxTaxBps;
  const exemptFull = exempt.length >= (curveConfig?.maxSnipeExempt ?? 16);

  // Fee summary for the preview: the recipient keeps their share of the base
  // fee plus the whole creator tax. Which base fee and which split depends on
  // where the launch trades -- a curve charges its own, a direct pool charges
  // the pool's and splits it at the launchpad's rate.
  const baseFeeBps = onCurve ? (curveConfig?.tradeFeeBps ?? 100) : POOL_FEE / 100;
  const splitProtocolBps = onCurve
    ? (curveConfig?.protocolFeeBps ?? 3_000)
    : ((padProtocolBps as number | undefined) ?? 3_000);
  // The tax is split on the same terms as the base fee, so the creator's cut is
  // one share of everything a trader pays rather than the whole tax plus a
  // share of the base.
  const totalFeeBps = baseFeeBps + creatorTaxBps;
  const yoursBps = (totalFeeBps * (10_000 - splitProtocolBps)) / 10_000;
  const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
  const protocolBps = onCurve
    ? curveConfig?.protocolFeeBps
    : (padProtocolBps as number | undefined);
  const splitLabel =
    protocolBps === undefined
      ? "…"
      : t("fees.split.v", { creator: pct(10_000 - protocolBps), protocol: pct(protocolBps) });
  const goalUsd = curveConfig ? Number(curveConfig.graduationUsdc) / 10 ** USDC_DECIMALS : 0;
  const devBuyGraduates =
    !!curveConfig && devBuyWei > 0n && Number(devBuy) >= grossToGraduateUsd(curveConfig, creatorTaxBps);

  function addExempt() {
    const a = exemptDraft.trim();
    if (!isAddress(a) || exemptFull || exempt.some((x) => x.toLowerCase() === a.toLowerCase())) return;
    setExempt([...exempt, a as Address]);
    setExemptDraft("");
  }

  const [mining, setMining] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supply = DEFAULT_SUPPLY;

  // --- derived economics -------------------------------------------------
  const { tickLower, tickUpper, startActual, ceilingActual } =
    useMemo(() => {
      // Every direct launch opens at the same market cap with the same ceiling,
      // so no launch can be priced to trap its buyers.
      const lower = startTickForMarketCap(DEFAULT_START_MCAP_USD, supply);
      const upper = ceilingTick(lower, DEFAULT_CEILING_MULTIPLE);
      return {
        tickLower: lower,
        tickUpper: upper,
        startActual: marketCapAtTick(lower, supply),
        ceilingActual: marketCapAtTick(upper, supply),
      };
    }, [supply]);

  const metadataURI = useMemo(
    () =>
      encodeMetadata({
        description,
        image,
        website,
        twitter,
        telegram,
        fundsLabel: redirecting ? fundsLabel : "",
      }),
    [description, image, website, twitter, telegram, redirecting, fundsLabel],
  );

  const totalSupplyWei = parseUnits(supply.toString(), TOKEN_DECIMALS);

  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<Hex | undefined>();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  // On confirmation, pull the token address straight out of the Launched event.
  // Both launchpads emit one, with `token` as the first indexed argument.
  useEffect(() => {
    if (!receipt.data) return;
    for (const log of receipt.data.logs) {
      for (const abi of [launchpadAbi, curveAbi] as const) {
        try {
          const parsed = decodeEventLog({ abi, data: log.data, topics: log.topics });
          if (parsed.eventName === "Launched") {
            const token = (parsed.args as { token: Address }).token;
            router.push(`/token/${token}`);
            return;
          }
        } catch {
          // Not this contract's event; keep scanning.
        }
      }
    }
  }, [receipt.data, router]);

  const nameOk = name.trim().length >= 2 && name.trim().length <= 32;
  const symbolOk = /^[A-Z0-9]{2,10}$/.test(symbol.trim().toUpperCase());
  const wrongChain = isConnected && chainId !== chain.id;
  const canSubmit =
    // creatorTaxOk applies to both launch types: the tax is charged by the same
    // hook either way, and it was previously only checked on the curve path.
    creatorTaxOk &&
    devBuyOk &&
    (onCurve ? !!curveConfig && curveWalletValid : isDeployed && recipientValid) &&
    isConnected &&
    !wrongChain &&
    nameOk &&
    symbolOk &&
    !mining &&
    !txHash;

  async function handleCurveLaunch() {
    if (!address || !publicClient) return;
    setError(null);
    setMining(true);
    try {
      const cleanName = name.trim();
      const cleanSymbol = symbol.trim().toUpperCase();

      // Same CREATE2 constraint as a direct launch, mined against the curve
      // contract because that is what deploys the token.
      setStatus(t("status.hashing"));
      const initCodeHash = (await publicClient.readContract({
        address: CURVE_ADDRESS,
        abi: curveAbi,
        functionName: "tokenInitCodeHash",
        args: [address, cleanName, cleanSymbol, metadataURI, curveHolders],
      })) as Hex;

      setStatus(t("status.mining"));
      const { salt, token, attempts } = await mineFreshSalt(publicClient, address, initCodeHash);
      setStatus(t("status.found", { addr: token.slice(0, 10), n: attempts }));

      // A developer buy is pulled by the curve inside the launch transaction,
      // so it needs an allowance first. Only exactly that amount is approved.
      if (devBuyWei > 0n) {
        const allowance = (await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, CURVE_ADDRESS],
        })) as bigint;
        if (allowance < devBuyWei) {
          setStatus(t("status.approving"));
          const approveHash = await writeContractAsync({
            address: USDC_ADDRESS,
            abi: erc20Abi,
            functionName: "approve",
            args: [CURVE_ADDRESS, devBuyWei],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }

      const hash = await writeContractAsync({
        address: CURVE_ADDRESS,
        abi: curveAbi,
        functionName: "launch",
        args: [
          {
            name: cleanName,
            symbol: cleanSymbol,
            metadataURI,
            salt,
            devBuyUsdc: devBuyWei,
            // The token does not exist before this transaction, so nothing
            // can trade ahead of the developer buy; the quote is exact.
            minTokensOut: 0n,
            feeRecipient: curveWallet.trim() ? (curveWallet.trim() as Address) : zeroAddress,
            creatorTaxBps,
            rewardHolders: curveHolders,
            snipeExempt: exempt,
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

  async function handleLaunch() {
    if (onCurve) return handleCurveLaunch();
    if (!address || !publicClient) return;
    setError(null);
    setMining(true);
    try {
      // Resolved here rather than read from localStorage: the account copy is
      // the one that survives launching from a different device to the click.
      const referrer = await accountReferrer(await getAccessToken().catch(() => null));

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
      const { salt, token, attempts } = await mineFreshSalt(publicClient, address, initCodeHash);
      setStatus(t("status.found", { addr: token.slice(0, 10), n: attempts }));

      // The pad pulls the developer buy out of the creator's wallet inside
      // `launch`, so it needs an allowance first -- same as the curve path.
      if (devBuyWei > 0n) {
        const allowance = (await publicClient.readContract({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, LAUNCHPAD_ADDRESS],
        })) as bigint;
        if (allowance < devBuyWei) {
          setStatus(t("status.approving"));
          const approveHash = await writeContractAsync({
            address: USDC_ADDRESS,
            abi: erc20Abi,
            functionName: "approve",
            args: [LAUNCHPAD_ADDRESS, devBuyWei],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
      }

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
            devBuyUsdc: devBuyWei,
            // The hook charges this on every swap for as long as the token
            // trades -- buys and sells alike, before and after graduation.
            creatorTaxBps,
            rewardHolders,
            // An earmarked launch has no recipient at all until somebody proves
            // the identity is theirs, so it deliberately goes out with zero.
            feeRecipient: redirecting && !earmarking
              ? (feeRecipientInput.trim() as Address)
              : zeroAddress,
            buybackAndBurn: burning,
            // Earmarking fees for an identity is not wired into this form yet;
            // a launch made here always names a concrete recipient or nobody.
            recipientCommitment: commitment ?? EMPTY_COMMITMENT,
            // Carried from ?ref= if the creator arrived through someone's link.
            referrer,
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

            <Field label={t("field.website")} optional>
              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="yourproject.com"
                className={inputCx(true)}
              />
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

            {isCurveDeployed && isDeployed ? (
              <div>
                <span className="eyebrow mb-1.5 block">{t("create.type")}</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["curve", "direct"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setLaunchType(kind)}
                      className={cx(
                        "block border-2 p-3 text-left transition-colors",
                        launchType === kind ? "border-lime bg-lime/10" : "border-line hover:border-line-bright",
                      )}
                    >
                      <span
                        className={cx("block text-sm font-bold", launchType === kind ? "text-lime" : "text-ink")}
                      >
                        {t(kind === "curve" ? "create.type.curve.t" : "create.type.direct.t")}
                      </span>
                      <span className="mt-1 block text-xs leading-snug text-muted">
                        {kind === "curve"
                          ? t("create.type.curve.b", {
                              goal: formatUsd(goalUsd, { compact: false }),
                              mcap: curveConfig ? formatUsd(graduationMarketCapUsd(curveConfig)) : "…",
                            })
                          : t("create.type.direct.b")}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

                <Field
              label={t("curve.tax")}
              hint={t("curve.tax.hint", {
                total: pct(totalFeeBps),
                yours: pct(yoursBps),
                max: pct(maxTaxBps),
              })}
            >
              <div
                className={cx(
                  "flex items-center border-2 bg-void focus-within:border-lime",
                  creatorTaxOk ? "border-line" : "border-pink",
                )}
              >
                <input
                  type="number"
                  min={0}
                  max={maxTaxBps / 100}
                  step={0.5}
                  value={creatorTaxPct}
                  onChange={(e) => {
                    // Clamped here rather than only validated: `max` on a number
                    // input stops the spinner, not typing, and 30 in this box is
                    // a launch that reverts.
                    const v = Number(e.target.value);
                    if (Number.isNaN(v)) return setCreatorTaxPct(0);
                    setCreatorTaxPct(Math.min(Math.max(v, 0), maxTaxBps / 100));
                  }}
                  className="tabular w-full bg-transparent px-3 py-2 text-sm outline-none"
                />
                <span className="px-3 text-sm text-muted">%</span>
              </div>
            </Field>

            {onCurve ? (
              <>
                {devBuyGraduates ? (
                  <p className="border-2 border-cyan p-2 text-xs text-cyan">{t("curve.devBuy.graduates")}</p>
                ) : null}

                <button
                  type="button"
                  onClick={() => setAdvanced((v) => !v)}
                  className="flex w-full items-center justify-between border-t-2 border-line pt-4 text-left"
                >
                  <span className="text-sm font-bold">{t("curve.advanced")}</span>
                  <span className="text-muted">{advanced ? "▴" : "▾"}</span>
                </button>

                {advanced ? (
                  <div className="space-y-5">
                    <div>
                      <span className="eyebrow mb-1.5 block">{t("curve.holders.t")}</span>
                      <button
                        type="button"
                        onClick={() => setCurveHolders((v) => !v)}
                        className="flex items-center gap-3 text-sm"
                      >
                        <span
                          className={cx(
                            "relative inline-block h-5 w-10 border-2 transition-colors",
                            curveHolders ? "border-lime bg-lime" : "border-line bg-void",
                          )}
                        >
                          <span
                            className={cx(
                              "absolute top-0.5 size-3",
                              curveHolders ? "right-0.5 bg-void" : "left-0.5 bg-muted",
                            )}
                          />
                        </span>
                        {curveHolders ? t("curve.holders.on") : t("curve.holders.off")}
                      </button>
                      <span className="mt-1.5 block text-xs text-muted">{t("curve.holders.b")}</span>
                    </div>

                    <Field label={t("curve.wallet")} hint={t("curve.wallet.hint")}>
                      <input
                        value={curveWallet}
                        onChange={(e) => setCurveWallet(e.target.value)}
                        placeholder={address ?? "0x…"}
                        className={cx(inputCx(curveWalletValid), "tabular")}
                      />
                    </Field>

                    <Field
                      label={t("curve.exempt")}
                      optional
                      hint={t("curve.exempt.hint", { n: curveConfig?.maxSnipeExempt ?? 16 })}
                    >
                      <div className="flex gap-2">
                        <input
                          value={exemptDraft}
                          onChange={(e) => setExemptDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addExempt();
                            }
                          }}
                          placeholder={t("curve.exempt.ph")}
                          className={cx(inputCx(exemptDraft === "" || isAddress(exemptDraft.trim())), "tabular")}
                        />
                        <button
                          type="button"
                          onClick={addExempt}
                          disabled={exemptFull || !isAddress(exemptDraft.trim())}
                          className="border-2 border-line px-3 text-lg text-muted hover:border-lime hover:text-lime disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                      {exempt.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {exempt.map((a) => (
                            <li key={a} className="tabular flex items-center justify-between text-xs text-muted">
                              <span>{a}</span>
                              <button
                                type="button"
                                onClick={() => setExempt(exempt.filter((x) => x !== a))}
                                className="px-2 text-pink"
                              >
                                ×
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </Field>
                  </div>
                ) : null}
              </>
            ) : (
              <>
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
                  <div className="flex gap-2">
                    {(["wallet", "identity"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setRecipientKind(k)}
                        className={cx(
                          "flex-1 border-2 px-3 py-2 text-xs font-bold uppercase tracking-wide",
                          recipientKind === k
                            ? "border-lime bg-lime/10 text-lime"
                            : "border-line text-muted hover:border-line-bright",
                        )}
                      >
                        {t(k === "wallet" ? "field.recipient.wallet" : "field.recipient.identity")}
                      </button>
                    ))}
                  </div>

                  {recipientKind === "wallet" ? (
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
                  ) : (
                    <Field label={t("field.identity")} hint={t("field.identity.hint")}>
                      <div className="flex gap-2">
                        <select
                          value={provider}
                          onChange={(e) => setProvider(e.target.value as Provider)}
                          className="border-2 border-line bg-void px-2 py-2.5 font-mono text-sm text-ink outline-none"
                        >
                          {PROVIDERS.map((p) => (
                            <option key={p} value={p}>
                              {p === "x" ? "X" : p === "github" ? "GitHub" : "Discord"}
                            </option>
                          ))}
                        </select>
                        <input
                          value={identityHandle}
                          onChange={(e) => setIdentityHandle(e.target.value)}
                          placeholder={provider === "github" ? "octocat" : "@handle"}
                          className={cx(
                            inputCx(identityHandle === "" || commitment !== null),
                            "flex-1",
                          )}
                        />
                      </div>
                    </Field>
                  )}

                  {earmarking && commitment ? (
                    <p className="text-xs leading-relaxed text-cyan">
                      {t("field.identity.escrow", { who: labelFor(provider, identityHandle) })}
                    </p>
                  ) : null}
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
                  label={t("curve.devBuy")}
                  optional
                  hint={t(onCurve ? "curve.devBuy.hint" : "direct.devBuy.hint", {
                    bal: usdcFloat.toLocaleString("en-US", { maximumFractionDigits: 2 }),
                  })}
                >
                  <div
                    className={cx(
                      "flex items-center border-2 bg-void focus-within:border-lime",
                      devBuyOk ? "border-line" : "border-pink",
                    )}
                  >
                    <input
                      value={devBuy}
                      onChange={(e) => setDevBuy(e.target.value)}
                      placeholder="0.00"
                      inputMode="decimal"
                      className="tabular w-full bg-transparent px-3 py-2.5 text-lg font-bold outline-none placeholder:text-faint"
                    />
                    <span className="tabular px-2 text-sm text-muted">USDC</span>
                    <button
                      type="button"
                      onClick={() => setDevBuy(usdcFloat > 0 ? usdcFloat.toString() : "")}
                      className="mr-2 border-2 border-lime px-2 py-0.5 text-xs font-bold text-lime hover:bg-lime hover:text-void"
                    >
                      {t("curve.max")}
                    </button>
                  </div>
                </Field>
              </>
            )}
          </div>
        </Card>

        {/* ---------------- preview ---------------- */}
        <div className="space-y-4 lg:sticky lg:top-24">
          {onCurve ? (
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <p className="eyebrow">{t("preview.title")}</p>
                <Badge tone="cyan">{t("curve.badge")}</Badge>
              </div>
              <p className="text-2xl font-bold">{name.trim() || t("curve.pv.name")}</p>
              <p className="tabular text-sm text-muted">
                {symbol.trim() ? `$${symbol.trim().toUpperCase()}` : t("curve.pv.ticker")}
              </p>
              <dl className="mt-4 divide-y-2 divide-line border-t-2 border-line">
                <Row
                  k={t("curve.pv.launchFee")}
                  v={
                    curveConfig && curveConfig.launchFee > 0n
                      ? formatUsd(formatUnitsFloat(curveConfig.launchFee, USDC_DECIMALS), { compact: false })
                      : t("curve.pv.free")
                  }
                />
                <Row k={t("curve.pv.paired")} v="USDC" />
                <Row
                  k={t("curve.pv.tradeFee")}
                  v={t("curve.pv.tradeFee.v", { total: pct(totalFeeBps), yours: pct(yoursBps) })}
                />
                <Row k={t("fees.split")} v={splitLabel} />
                <Row k={t("curve.pv.window")} v={t("curve.pv.window.v")} />
                <Row k={t("curve.pv.opens")} v={curveConfig ? formatUsd(openingMarketCapUsd(curveConfig)) : "…"} />
                <Row
                  k={t("curve.pv.graduation")}
                  v={t("curve.pv.graduation.v", {
                    goal: formatUsd(goalUsd, { compact: false }),
                    mcap: curveConfig ? formatUsd(graduationMarketCapUsd(curveConfig)) : "…",
                  })}
                />
                <Row k={t("curve.pv.pool")} v={t("preview.badge.direct")} />
                <Row k={t("curve.pv.liquidity")} v={t("curve.pv.liquidity.v")} />
              </dl>
              <p className="mt-4 border-t-2 border-line pt-4 text-xs leading-relaxed text-muted">
                {t("curve.pv.explain", { goal: formatUsd(goalUsd, { compact: false }) })}
              </p>
            </Card>
          ) : (
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="eyebrow">{t("preview.title")}</p>
              <Badge tone="cyan">{t("preview.badge.direct")}</Badge>
            </div>
            <p className="text-2xl font-bold">{name.trim() || t("curve.pv.name")}</p>
            <p className="tabular text-sm text-muted">
              {symbol.trim() ? `$${symbol.trim().toUpperCase()}` : t("curve.pv.ticker")}
            </p>
            <dl className="mt-4 divide-y-2 divide-line border-t-2 border-line">
              <Row k={t("curve.pv.launchFee")} v={t("curve.pv.free")} />
              <Row k={t("curve.pv.paired")} v="USDC" />
              <Row
                k={t("curve.pv.tradeFee")}
                v={
                  creatorTaxBps > 0
                    ? t("curve.pv.tradeFee.v", { total: pct(totalFeeBps), yours: pct(yoursBps) })
                    : pct(baseFeeBps)
                }
              />
              <Row k={t("fees.split")} v={splitLabel} />
              <Row k={t("preview.opensAt")} v={formatUsd(startActual)} />
              <Row k={t("preview.ceiling")} v={formatUsd(ceilingActual)} />
              <Row k={t("curve.pv.liquidity")} v={t("curve.pv.liquidity.v")} />
              <Row
                k={t("preview.feesTo")}
                v={
                  feeMode === "creator"
                    ? t("preview.badge.creator")
                    : feeMode === "holders"
                      ? t("preview.badge.holders")
                      : feeMode === "burn"
                        ? t("preview.badge.burn")
                        : (beneficiaryLink(fundsLabel)?.text ?? t("preview.badge.funds.fallback"))
                }
              />
            </dl>
            <p className="mt-4 border-t-2 border-line pt-4 text-xs leading-relaxed text-muted">
              {t("preview.explain.short", { start: formatUsd(startActual) })}
            </p>
          </Card>
          )}

          <Card className="p-5">
            <p className="eyebrow mb-3">{t("cost.title")}</p>
            <div className="flex items-baseline gap-2">
              <span className="tabular text-3xl font-bold text-lime">
                {onCurve && devBuyWei > 0n ? formatUsd(Number(devBuy), { compact: false }) : "$0"}
              </span>
              <span className="text-sm text-muted">
                {onCurve && devBuyWei > 0n ? t("cost.devBuy") : t("cost.gas")}
              </span>
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
            {!(onCurve ? isCurveDeployed : isDeployed)
              ? t("cta.notDeployed")
              : !isConnected
                ? t("cta.connect")
                : wrongChain
                  ? t(IS_MAINNET ? "cta.switchNetwork.mainnet" : "cta.switchNetwork")
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
      <dt className="text-muted">{k}</dt>
      <dd className="tabular text-right font-bold">{v}</dd>
    </div>
  );
}

function inputCx(valid: boolean): string {
  return cx(
    "w-full border-2 bg-void px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none",
    valid ? "border-line focus:border-lime" : "border-pink",
  );
}
