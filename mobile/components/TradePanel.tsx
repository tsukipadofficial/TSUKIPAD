import { useEffect, useMemo, useState } from "react";
import {
  View, Text, TextInput, Pressable, ActivityIndicator, Linking,
} from "react-native";
import type { Address } from "viem";
import { parseUnits, formatUnits } from "viem";
import { c, font } from "../lib/theme";
import { Card, Eyebrow } from "./ui";
import {
  client, quoteSwap, allowanceOf, type TokenInfo,
} from "../lib/chain";
import {
  USDC_ADDRESS, USDC_DECIMALS, TOKEN_DECIMALS, SWAP_ROUTER_ADDRESS, POOL_FEE, EXPLORER_URL,
} from "../lib/config";
import { erc20Abi, swapRouterAbi } from "../lib/abi";
import { usd } from "../lib/format";
import { useWallet } from "../lib/wallet";

type Side = "buy" | "sell";
const SLIPPAGE_PCT = 3;

export function TradePanel({ t }: { t: TokenInfo }) {
  const wallet = useWallet();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const decIn = side === "buy" ? USDC_DECIMALS : TOKEN_DECIMALS;
  const decOut = side === "buy" ? TOKEN_DECIMALS : USDC_DECIMALS;
  const tokenIn = side === "buy" ? USDC_ADDRESS : t.token;
  const tokenOut = side === "buy" ? t.token : USDC_ADDRESS;

  const amountIn = useMemo(() => {
    try { return amount ? parseUnits(amount, decIn) : 0n; } catch { return 0n; }
  }, [amount, decIn]);

  // Quote. With a connected wallet the router is simulated from that address,
  // which yields the exact output including fees and price impact. Without one
  // the router would revert (it cannot pull tokens), so fall back to the pool's
  // mid price — clearly labelled as an estimate.
  useEffect(() => {
    let alive = true;
    if (amountIn === 0n) { setQuote(null); return; }
    setQuoting(true);
    const run = async () => {
      let q: bigint | null = null;
      if (wallet.address) {
        q = await quoteSwap({ tokenIn, tokenOut, amountIn, account: wallet.address });
      }
      if (q === null && t.priceUsd > 0) {
        const inF = Number(formatUnits(amountIn, decIn));
        const outF = side === "buy" ? inF / t.priceUsd : inF * t.priceUsd;
        q = parseUnits(outF.toFixed(Math.min(decOut, 8)), decOut);
      }
      if (alive) { setQuote(q); setQuoting(false); }
    };
    const id = setTimeout(run, 350);
    return () => { alive = false; clearTimeout(id); };
  }, [amountIn, side, wallet.address, tokenIn, tokenOut, t.priceUsd, decIn, decOut]);

  const exact = wallet.address !== null;
  const outF = quote !== null ? Number(formatUnits(quote, decOut)) : null;

  async function trade() {
    if (!wallet.address || quote === null || amountIn === 0n) return;
    setErr(null); setTxHash(null);
    try {
      // ERC20 allowance for the router, if this input needs one.
      setBusy("checking allowance");
      const allowance = await allowanceOf(tokenIn, wallet.address);
      if (allowance < amountIn) {
        setBusy("approve in your wallet");
        await wallet.writeContract({
          address: tokenIn, abi: erc20Abi, functionName: "approve",
          args: [SWAP_ROUTER_ADDRESS, amountIn],
        });
      }
      setBusy("confirm the swap");
      const minOut = (quote * BigInt(Math.round((100 - SLIPPAGE_PCT) * 100))) / 10_000n;
      const hash = await wallet.writeContract({
        address: SWAP_ROUTER_ADDRESS, abi: swapRouterAbi, functionName: "exactInputSingle",
        args: [{
          tokenIn, tokenOut, fee: POOL_FEE, recipient: wallet.address,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 900),
          amountIn, amountOutMinimum: minOut,
        }],
      });
      setBusy("confirming on chain");
      await client.waitForTransactionReceipt({ hash });
      setTxHash(hash);
      setAmount("");
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message?.split("\n")[0] ?? "Trade failed");
    } finally {
      setBusy(null);
    }
  }

  const disabled = !wallet.address || amountIn === 0n || quote === null || busy !== null;

  return (
    <Card>
      <View style={{ padding: 16 }}>
        {/* buy / sell */}
        <View style={{ flexDirection: "row", borderWidth: 2, borderColor: c.line }}>
          {(["buy", "sell"] as Side[]).map((s) => (
            <Pressable key={s} onPress={() => { setSide(s); setAmount(""); setQuote(null); }} style={{ flex: 1 }}>
              <View style={{ backgroundColor: side === s ? (s === "buy" ? c.lime : c.pink) : "transparent", paddingVertical: 11 }}>
                <Text style={{
                  textAlign: "center", fontFamily: font.display, fontSize: 15,
                  color: side === s ? c.void : c.muted,
                }}>{s.toUpperCase()}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        <Eyebrow style={{ marginTop: 16 }}>
          {side === "buy" ? "you pay (USDC)" : `you sell ($${t.symbol})`}
        </Eyebrow>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          placeholder="0.00"
          placeholderTextColor={c.faint}
          keyboardType="decimal-pad"
          style={{
            marginTop: 8, backgroundColor: c.surface2, borderWidth: 2, borderColor: c.line,
            color: c.ink, fontFamily: font.monoBold, fontSize: 26, padding: 13,
          }}
        />

        <View style={{ marginTop: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Eyebrow>{exact ? "you receive" : "estimate"}</Eyebrow>
          {quoting ? <ActivityIndicator color={c.faint} size="small" /> : (
            <Text style={{ fontFamily: font.monoBold, fontSize: 17, color: c.lime }}>
              {outF === null ? "—" :
                side === "buy"
                  ? `${outF.toLocaleString(undefined, { maximumFractionDigits: 0 })} $${t.symbol}`
                  : usd(outF)}
            </Text>
          )}
        </View>
        {!exact && amountIn > 0n ? (
          <Text style={{ fontFamily: font.mono, fontSize: 11, color: c.amber, marginTop: 6 }}>
            Estimated from the pool price. Connect to get an exact quote.
          </Text>
        ) : null}
        <Text style={{ fontFamily: font.mono, fontSize: 11, color: c.faint, marginTop: 6 }}>
          Max slippage {SLIPPAGE_PCT}% · 1% pool fee
        </Text>

        {err ? (
          <Text style={{ fontFamily: font.mono, fontSize: 12, color: c.pink, marginTop: 12 }}>{err}</Text>
        ) : null}
        {txHash ? (
          <Pressable onPress={() => Linking.openURL(`${EXPLORER_URL}/tx/${txHash}`)}>
            <Text style={{ fontFamily: font.mono, fontSize: 12, color: c.cyan, marginTop: 12 }}>
              Done — view transaction ↗
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={wallet.address ? trade : wallet.connect}
          disabled={wallet.address ? disabled : false}
          style={{ marginTop: 16, opacity: wallet.address && disabled ? 0.45 : 1 }}
        >
          <View style={{
            backgroundColor: side === "buy" ? c.lime : c.pink,
            borderWidth: 2, borderColor: c.void, paddingVertical: 15, alignItems: "center",
          }}>
            {busy ? (
              <Text style={{ fontFamily: font.display, fontSize: 14, color: c.void }}>
                {busy.toUpperCase()}…
              </Text>
            ) : (
              <Text style={{ fontFamily: font.display, fontSize: 16, color: c.void }}>
                {!wallet.address ? "SIGN IN TO TRADE"
                  : side === "buy" ? `BUY $${t.symbol}` : `SELL $${t.symbol}`}
              </Text>
            )}
          </View>
        </Pressable>
      </View>
    </Card>
  );
}
