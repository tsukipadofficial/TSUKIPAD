import { useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, Linking } from "react-native";
import { isAddress, type Address } from "viem";
import { c, font } from "../../lib/theme";
import { fetchUsdcBalance, client } from "../../lib/chain";
import { erc20Abi } from "../../lib/abi";
import { fetchLaunches, type TokenInfo } from "../../lib/chain";
import { TOKEN_DECIMALS, EXPLORER_URL } from "../../lib/config";
import { usd, short } from "../../lib/format";
import { Card, Eyebrow } from "../../components/ui";

type Holding = { t: TokenInfo; amount: number; valueUsd: number };

/// Watch-only by design. Signing needs WalletConnect, which needs a project id
/// the project doesn't have yet; until then an address can be tracked without
/// asking anyone to expose a key.
export default function Portfolio() {
  const [addr, setAddr] = useState("");
  const [tracked, setTracked] = useState<Address | null>(null);
  const [usdc, setUsdc] = useState<number | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function track() {
    const a = addr.trim();
    if (!isAddress(a)) { setErr("That is not a valid address"); return; }
    setBusy(true); setErr(null);
    try {
      const [bal, launches] = await Promise.all([fetchUsdcBalance(a), fetchLaunches()]);
      const hs = await Promise.all(
        launches.map(async (t) => {
          const raw = await client.readContract({
            address: t.token, abi: erc20Abi, functionName: "balanceOf", args: [a],
          });
          const amount = Number(raw) / 10 ** TOKEN_DECIMALS;
          return { t, amount, valueUsd: amount * t.priceUsd };
        }),
      );
      setUsdc(bal);
      setHoldings(hs.filter((h) => h.amount > 0).sort((x, y) => y.valueUsd - x.valueUsd));
      setTracked(a);
    } catch (e: any) {
      setErr(e?.shortMessage ?? "Could not read that address");
    } finally { setBusy(false); }
  }

  const total = (usdc ?? 0) + holdings.reduce((s, h) => s + h.valueUsd, 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.void }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Eyebrow>track an address</Eyebrow>
      <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
        <TextInput
          value={addr}
          onChangeText={setAddr}
          placeholder="0x…"
          placeholderTextColor={c.faint}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            flex: 1, backgroundColor: c.surface, borderWidth: 2, borderColor: c.line,
            color: c.ink, fontFamily: font.mono, fontSize: 13, paddingHorizontal: 12, paddingVertical: 12,
          }}
        />
        <Pressable onPress={track} disabled={busy}>
          <View style={{ backgroundColor: c.lime, borderWidth: 2, borderColor: c.void, paddingHorizontal: 18, justifyContent: "center", height: "100%" }}>
            {busy ? <ActivityIndicator color={c.void} />
              : <Text style={{ fontFamily: font.display, fontSize: 14, color: c.void }}>TRACK</Text>}
          </View>
        </Pressable>
      </View>
      {err ? <Text style={{ fontFamily: font.mono, color: c.pink, fontSize: 12, marginTop: 8 }}>{err}</Text> : null}

      {tracked ? (
        <>
          <View style={{ marginTop: 26 }}>
            <Card accent>
              <View style={{ padding: 18 }}>
                <Text style={{ fontFamily: font.monoBold, fontSize: 11, letterSpacing: 1.6, color: c.void, opacity: 0.7 }}>
                  TOTAL VALUE
                </Text>
                <Text style={{ fontFamily: font.display, fontSize: 40, color: c.void, marginTop: 4 }}>
                  {usd(total)}
                </Text>
                <Text style={{ fontFamily: font.mono, fontSize: 12, color: c.void, opacity: 0.7, marginTop: 6 }}>
                  {short(tracked)} · {usd(usdc ?? 0)} USDC
                </Text>
              </View>
            </Card>
          </View>

          <Text style={{ fontFamily: font.monoBold, fontSize: 11, letterSpacing: 1.6, color: c.faint, marginTop: 28, marginBottom: 12 }}>
            HOLDINGS ({holdings.length})
          </Text>
          {holdings.length === 0 ? (
            <Text style={{ fontFamily: font.mono, color: c.faint, fontSize: 13 }}>
              No launchpad tokens held by this address.
            </Text>
          ) : holdings.map((h) => (
            <View key={h.t.token} style={{ marginBottom: 12 }}>
              <Card>
                <View style={{ padding: 14, flexDirection: "row", alignItems: "center" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: font.display, fontSize: 16, color: c.ink }}>${h.t.symbol}</Text>
                    <Text style={{ fontFamily: font.mono, fontSize: 12, color: c.muted, marginTop: 2 }}>
                      {h.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: font.monoBold, fontSize: 15, color: c.lime }}>{usd(h.valueUsd)}</Text>
                </View>
              </Card>
            </View>
          ))}

          <Pressable onPress={() => Linking.openURL(`${EXPLORER_URL}/address/${tracked}`)} style={{ marginTop: 18 }}>
            <Text style={{ fontFamily: font.mono, fontSize: 12, color: c.cyan }}>
              View on Arcscan ↗
            </Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}
