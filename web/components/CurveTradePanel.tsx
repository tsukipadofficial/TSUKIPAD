"use client";

import { useEffect, useMemo, useState } from "react";
import { parseUnits, maxUint256, type Address } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";

import { Button, Card, cx } from "./ui";
import { curveAbi, erc20Abi } from "@/lib/abi";
import { CURVE_ADDRESS, USDC_ADDRESS, USDC_DECIMALS, TOKEN_DECIMALS, chain } from "@/lib/config";
import { formatUnitsFloat, formatUsd } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { LaunchView } from "@/lib/hooks";

type Side = "buy" | "sell";

const QUICK_USDC = [10, 50, 100, 500];
const QUICK_PCT = [25, 50, 75, 100];
const SLIPPAGE_OPTIONS = [0.5, 1, 5];

const NOBODY: Address = "0x000000000000000000000000000000000000dEaD";

/// Buys and sells against the bonding curve, before a launch graduates.
///
/// Quotes come from the curve's own `quoteBuy` / `quoteSell` views rather than a
/// simulated trade, so they work for a visitor with no balance or allowance, and
/// they include the snipe tax the connected wallet would pay right now.
export function CurveTradePanel({ launch, onTraded }: { launch: LaunchView; onTraded?: () => void }) {
  const t = useT();
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [debounced, setDebounced] = useState("");
  const [slippage, setSlippage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrongChain = isConnected && chainId !== chain.id;
  const tokenIn = side === "buy" ? USDC_ADDRESS : launch.token;
  const decimalsIn = side === "buy" ? USDC_DECIMALS : TOKEN_DECIMALS;
  const decimalsOut = side === "buy" ? TOKEN_DECIMALS : USDC_DECIMALS;

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(amount), 250);
    return () => clearTimeout(timer);
  }, [amount]);

  const amountIn = useMemo(() => parseAmount(amount, decimalsIn), [amount, decimalsIn]);
  const quoteAmount = useMemo(() => parseAmount(debounced, decimalsIn), [debounced, decimalsIn]);

  const { data: balanceIn, refetch: refetchBalance } = useReadContract({
    address: tokenIn,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !wrongChain, refetchInterval: 15_000 },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenIn,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, CURVE_ADDRESS] : undefined,
    query: { enabled: !!address && !wrongChain },
  });

  const buyQuote = useReadContract({
    address: CURVE_ADDRESS,
    abi: curveAbi,
    functionName: "quoteBuy",
    args: [launch.token, quoteAmount, address ?? NOBODY],
    query: { enabled: side === "buy" && quoteAmount > 0n, refetchInterval: 4_000 },
  });
  const sellQuote = useReadContract({
    address: CURVE_ADDRESS,
    abi: curveAbi,
    functionName: "quoteSell",
    args: [launch.token, quoteAmount],
    query: { enabled: side === "sell" && quoteAmount > 0n, refetchInterval: 4_000 },
  });
  const { data: snipeTax } = useReadContract({
    address: CURVE_ADDRESS,
    abi: curveAbi,
    functionName: "snipeTaxBps",
    args: [launch.token, address ?? NOBODY],
    query: { enabled: side === "buy", refetchInterval: 1_000 },
  });

  const stale = amount !== debounced;
  const quote = useMemo(() => {
    if (stale || quoteAmount === 0n) return null;
    if (side === "buy") {
      const r = buyQuote.data as readonly [bigint, bigint, bigint] | undefined;
      return r ? { out: r[0], used: r[1], fee: r[2] } : null;
    }
    const r = sellQuote.data as readonly [bigint, bigint] | undefined;
    return r ? { out: r[0], used: quoteAmount, fee: r[1] } : null;
  }, [stale, quoteAmount, side, buyQuote.data, sellQuote.data]);

  const needsApproval = allowance !== undefined && (allowance as bigint) < amountIn;
  const balanceFloat = balanceIn ? formatUnitsFloat(balanceIn as bigint, decimalsIn) : 0;
  const insufficient = balanceIn !== undefined && amountIn > (balanceIn as bigint);
  const finishesCurve =
    side === "buy" && !!launch.curve && quote !== null && quote.out > 0n &&
    launch.curve.tokensSold + quote.out >= launch.curve.curveSupply;
  const taxBps = Number((snipeTax as bigint | undefined) ?? 0n);

  async function handleApprove() {
    setBusy(true);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: tokenIn,
        abi: erc20Abi,
        functionName: "approve",
        args: [CURVE_ADDRESS, maxUint256],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      await refetchAllowance();
    } catch (e) {
      setError(shortError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleTrade() {
    if (!address || !quote) return;
    setBusy(true);
    setError(null);
    try {
      const minOut = (quote.out * BigInt(Math.round((100 - slippage) * 100))) / 10_000n;
      const hash =
        side === "buy"
          ? await writeContractAsync({
              address: CURVE_ADDRESS,
              abi: curveAbi,
              functionName: "buy",
              args: [launch.token, amountIn, minOut, address],
            })
          : await writeContractAsync({
              address: CURVE_ADDRESS,
              abi: curveAbi,
              functionName: "sell",
              args: [launch.token, amountIn, minOut, address],
            });
      setBusy(false);
      setConfirming(true);
      await publicClient?.waitForTransactionReceipt({ hash });
      setAmount("");
      void refetchBalance();
      void refetchAllowance();
      onTraded?.();
    } catch (e) {
      setError(shortError(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const outFloat = quote ? formatUnitsFloat(quote.out, decimalsOut) : null;

  return (
    <Card className="p-4">
      <p className="eyebrow mb-3 text-cyan">{t("trade.onCurve")}</p>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {(["buy", "sell"] as Side[]).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setAmount("");
              setError(null);
            }}
            className={cx(
              "border-2 py-2.5 text-sm font-bold uppercase tracking-wide transition-colors",
              side === s
                ? s === "buy"
                  ? "border-lime bg-lime text-void"
                  : "border-pink bg-pink text-void"
                : "border-line text-muted hover:border-line-bright hover:text-ink",
            )}
          >
            {s === "buy" ? t("token.buy") : t("token.sell")}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="eyebrow">{t("trade.youPay")}</span>
            <button
              onClick={() => setAmount(balanceFloat.toString())}
              className="tabular text-xs text-muted transition-colors hover:text-lime"
            >
              {t("trade.balance", {
                n: balanceFloat.toLocaleString("en-US", { maximumFractionDigits: 4 }),
                sym: side === "buy" ? "USDC" : launch.symbol,
              })}
            </button>
          </div>
          <div className="flex items-center border-2 border-line bg-void focus-within:border-lime">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              className="tabular w-full bg-transparent px-3 py-3 text-lg font-bold outline-none placeholder:text-faint"
            />
            <span className="tabular px-3 text-sm text-muted">{side === "buy" ? "USDC" : launch.symbol}</span>
          </div>

          <div className="mt-2 flex gap-1.5">
            {side === "buy"
              ? QUICK_USDC.map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(String(v))}
                    className="tabular flex-1 border-2 border-line py-1 text-xs text-muted transition-colors hover:border-lime hover:text-lime"
                  >
                    ${v}
                  </button>
                ))
              : QUICK_PCT.map((p) => (
                  <button
                    key={p}
                    onClick={() =>
                      setAmount(
                        p === 100 && balanceIn
                          ? formatUnitsExact(balanceIn as bigint, TOKEN_DECIMALS)
                          : ((balanceFloat * p) / 100).toString(),
                      )
                    }
                    className="tabular flex-1 border-2 border-line py-1 text-xs text-muted transition-colors hover:border-pink hover:text-pink"
                  >
                    {p}%
                  </button>
                ))}
          </div>
        </div>

        <div>
          <span className="eyebrow mb-1.5 block">{t("trade.youReceive")}</span>
          <div className="flex items-center justify-between border-2 border-line bg-surface-2 px-3 py-3">
            <span className="tabular text-lg font-bold">
              {amountIn > 0n && !quote ? (
                <span className="text-muted">…</span>
              ) : outFloat !== null ? (
                outFloat.toLocaleString("en-US", { maximumFractionDigits: side === "buy" ? 0 : 4 })
              ) : (
                <span className="text-faint">0.00</span>
              )}
            </span>
            <span className="tabular text-sm text-muted">{side === "buy" ? launch.symbol : "USDC"}</span>
          </div>
        </div>

        {quote ? (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">{t("trade.fee")}</span>
            <span className="tabular text-muted">{formatUsd(formatUnitsFloat(quote.fee, USDC_DECIMALS))}</span>
          </div>
        ) : null}

        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">{t("trade.slippage")}</span>
          <div className="flex gap-1">
            {SLIPPAGE_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setSlippage(s)}
                className={cx(
                  "tabular border-2 px-2 py-0.5 transition-colors",
                  slippage === s ? "border-lime text-lime" : "border-line text-muted hover:text-ink",
                )}
              >
                {s}%
              </button>
            ))}
          </div>
        </div>

        {side === "buy" && taxBps > 0 ? (
          <p className="border-2 border-amber p-2 text-xs text-amber">
            {t("trade.snipeTax", { pct: `${(taxBps / 100).toFixed(taxBps >= 1000 ? 0 : 1)}%` })}
          </p>
        ) : null}

        {finishesCurve ? (
          <p className="border-2 border-cyan p-2 text-xs text-cyan">
            {t("trade.curveGraduates", { used: formatUsd(formatUnitsFloat(quote!.used, USDC_DECIMALS)) })}
          </p>
        ) : null}

        {error ? <p className="text-xs text-pink">{error}</p> : null}

        {!isConnected ? (
          <Button className="w-full" size="lg" disabled>
            {t("cta.connect")}
          </Button>
        ) : wrongChain ? (
          <Button className="w-full" size="lg" variant="pink" disabled>
            {t("trade.wrongNetwork")}
          </Button>
        ) : needsApproval && amountIn > 0n ? (
          <Button className="w-full" size="lg" onClick={handleApprove} disabled={busy}>
            {busy ? t("trade.approving") : t("trade.approve", { sym: side === "buy" ? "USDC" : launch.symbol })}
          </Button>
        ) : (
          <Button
            className="w-full"
            size="lg"
            variant={side === "buy" ? "lime" : "pink"}
            disabled={busy || confirming || !quote || quote.out === 0n || insufficient}
            onClick={handleTrade}
          >
            {confirming
              ? t("trade.confirming")
              : busy
                ? t("trade.checkWallet")
                : side === "buy"
                  ? t("trade.buySym", { sym: launch.symbol })
                  : t("trade.sellSym", { sym: launch.symbol })}
          </Button>
        )}
      </div>
    </Card>
  );
}

function parseAmount(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!trimmed || Number.isNaN(Number(trimmed))) return 0n;
  try {
    return parseUnits(trimmed, decimals);
  } catch {
    return 0n;
  }
}

/// Exact decimal string for a balance, so "sell 100%" sells every last wei
/// rather than a float-rounded amount that is either dust short or too much.
function formatUnitsExact(value: bigint, decimals: number): string {
  const s = value.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

function shortError(e: unknown): string {
  const message = e instanceof Error ? e.message : "Transaction failed.";
  if (/User rejected|denied/i.test(message)) return "Cancelled in wallet.";
  if (/Slippage/.test(message)) return "Price moved past your slippage. Try again.";
  if (/AlreadyGraduated/.test(message)) return "This launch just graduated. Reload to trade in the pool.";
  return message.split("\n")[0];
}
