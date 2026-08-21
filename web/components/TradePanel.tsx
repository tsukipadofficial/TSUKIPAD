"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits, maxUint256, type Address } from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";

import { Button, Card, cx } from "./ui";
import { erc20Abi, swapRouterAbi } from "@/lib/abi";
import {
  SWAP_ROUTER_ADDRESS,
  USDC_ADDRESS,
  USDC_DECIMALS,
  TOKEN_DECIMALS,
  POOL_FEE,
  chain,
} from "@/lib/config";
import { formatUnitsFloat } from "@/lib/format";
import { useT } from "@/lib/i18n";
import type { LaunchView } from "@/lib/hooks";

type Side = "buy" | "sell";

const QUICK_USDC = [10, 50, 100, 500];
const QUICK_PCT = [25, 50, 75, 100];
const SLIPPAGE_OPTIONS = [0.5, 1, 5];

export function TradePanel({ launch }: { launch: LaunchView }) {
  const t = useT();
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(1);
  const [quote, setQuote] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();

  const wrongChain = isConnected && chainId !== chain.id;

  const tokenIn = side === "buy" ? USDC_ADDRESS : launch.token;
  const tokenOut = side === "buy" ? launch.token : USDC_ADDRESS;
  const decimalsIn = side === "buy" ? USDC_DECIMALS : TOKEN_DECIMALS;
  const decimalsOut = side === "buy" ? TOKEN_DECIMALS : USDC_DECIMALS;

  const { data: balanceIn, refetch: refetchBalance } = useReadContract({
    address: tokenIn,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !wrongChain, refetchInterval: 20_000 },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: tokenIn,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, SWAP_ROUTER_ADDRESS] : undefined,
    query: { enabled: !!address && !wrongChain },
  });

  const amountIn = useMemo(() => {
    const trimmed = amount.trim();
    if (!trimmed || Number.isNaN(Number(trimmed))) return 0n;
    try {
      return parseUnits(trimmed, decimalsIn);
    } catch {
      return 0n;
    }
  }, [amount, decimalsIn]);

  const needsApproval = allowance !== undefined && (allowance as bigint) < amountIn;

  // --- quoting -----------------------------------------------------------
  // Static-call the router rather than deploying Uniswap's Quoter: the router's
  // exactInputSingle returns the output amount, so simulating it gives an exact
  // quote including fees and price impact, with no extra contract to maintain.
  useEffect(() => {
    if (!publicClient || amountIn === 0n) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setQuoting(true);
      setQuoteError(null);
      try {
        const { result } = await publicClient.simulateContract({
          address: SWAP_ROUTER_ADDRESS,
          abi: swapRouterAbi,
          functionName: "exactInputSingle",
          args: [
            {
              tokenIn,
              tokenOut,
              fee: POOL_FEE,
              recipient: address ?? "0x000000000000000000000000000000000000dEaD",
              deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
              amountIn,
              amountOutMinimum: 0n,
            },
          ],
          account: address ?? "0x000000000000000000000000000000000000dEaD",
        });
        if (!cancelled) setQuote(result as bigint);
      } catch {
        if (!cancelled) {
          // Most commonly: the account holds no balance/allowance yet, so the
          // simulation cannot pull tokens. Surface it as "no quote", not an error.
          setQuote(null);
          setQuoteError("quote-unavailable");
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [publicClient, amountIn, tokenIn, tokenOut, address]);

  const receipt = useWaitForTransactionReceipt({ hash: txHash });
  useEffect(() => {
    if (receipt.data) {
      setAmount("");
      setQuote(null);
      setTxHash(undefined);
      void refetchBalance();
      void refetchAllowance();
    }
  }, [receipt.data, refetchBalance, refetchAllowance]);

  async function handleApprove() {
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: tokenIn,
        abi: erc20Abi,
        functionName: "approve",
        args: [SWAP_ROUTER_ADDRESS, maxUint256],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      await refetchAllowance();
    } catch {
      // User rejected, or the token refused. Nothing to clean up.
    } finally {
      setBusy(false);
    }
  }

  async function handleSwap() {
    if (!address || quote === null) return;
    setBusy(true);
    try {
      const minOut = (quote * BigInt(Math.round((100 - slippage) * 100))) / 10_000n;
      const hash = await writeContractAsync({
        address: SWAP_ROUTER_ADDRESS,
        abi: swapRouterAbi,
        functionName: "exactInputSingle",
        args: [
          {
            tokenIn,
            tokenOut,
            fee: POOL_FEE,
            recipient: address,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
            amountIn,
            amountOutMinimum: minOut,
          },
        ],
      });
      setTxHash(hash);
    } catch {
      // Rejected or reverted; the panel stays as-is so the user can retry.
    } finally {
      setBusy(false);
    }
  }

  const balanceFloat = balanceIn ? formatUnitsFloat(balanceIn as bigint, decimalsIn) : 0;
  const outFloat = quote !== null ? formatUnitsFloat(quote, decimalsOut) : null;

  const priceImpact = useMemo(() => {
    if (quote === null || amountIn === 0n) return null;
    const inFloat = Number(formatUnits(amountIn, decimalsIn));
    const outF = Number(formatUnits(quote, decimalsOut));
    const spot = launch.marketCapUsd / Number(launch.supplyWhole);
    const executed = side === "buy" ? inFloat / outF : outF / inFloat;
    return ((executed - spot) / spot) * 100 * (side === "buy" ? 1 : -1);
  }, [quote, amountIn, decimalsIn, decimalsOut, launch, side]);

  const soldOut = launch.curveProgress >= 0.999;

  return (
    <Card className="p-4">
      <div className="mb-4 grid grid-cols-2 gap-2">
        {(["buy", "sell"] as Side[]).map((s) => (
          <button
            key={s}
            onClick={() => {
              setSide(s);
              setAmount("");
              setQuote(null);
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
            <span className="tabular px-3 text-sm text-muted">
              {side === "buy" ? "USDC" : launch.symbol}
            </span>
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
                    onClick={() => setAmount(((balanceFloat * p) / 100).toString())}
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
              {quoting ? (
                <span className="text-muted">…</span>
              ) : outFloat !== null ? (
                outFloat.toLocaleString("en-US", {
                  maximumFractionDigits: side === "buy" ? 0 : 4,
                })
              ) : (
                <span className="text-faint">0.00</span>
              )}
            </span>
            <span className="tabular text-sm text-muted">
              {side === "buy" ? launch.symbol : "USDC"}
            </span>
          </div>
        </div>

        {priceImpact !== null && Number.isFinite(priceImpact) ? (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">{t("trade.priceImpact")}</span>
            <span
              className={cx(
                "tabular font-bold",
                Math.abs(priceImpact) > 10 ? "text-pink" : "text-muted",
              )}
            >
              {priceImpact > 0 ? "+" : ""}
              {priceImpact.toFixed(2)}%
            </span>
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
                  slippage === s
                    ? "border-lime text-lime"
                    : "border-line text-muted hover:text-ink",
                )}
              >
                {s}%
              </button>
            ))}
          </div>
        </div>

        {quoteError && amountIn > 0n ? (
          <p className="text-xs text-amber">{t("trade.quoteUnavailable")}</p>
        ) : null}

        {soldOut && side === "buy" ? (
          <p className="border-2 border-pink p-2 text-xs text-pink">
            {t("trade.soldOut")}
          </p>
        ) : null}

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
            {busy
              ? t("trade.approving")
              : t("trade.approve", { sym: side === "buy" ? "USDC" : launch.symbol })}
          </Button>
        ) : (
          <Button
            className="w-full"
            size="lg"
            variant={side === "buy" ? "lime" : "pink"}
            disabled={busy || quote === null || receipt.isLoading}
            onClick={handleSwap}
          >
            {receipt.isLoading
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
