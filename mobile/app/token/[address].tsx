import { useEffect, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, Pressable, Linking } from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import Svg, { Polyline, Line } from "react-native-svg";
import type { Address } from "viem";
import { c, font } from "../../lib/theme";
import { fetchLaunches, type TokenInfo, client, priceFromSqrt } from "../../lib/chain";
import { poolAbi } from "../../lib/abi";
import { usd, short, ago, countdown } from "../../lib/format";
import { Card, Eyebrow, Tag } from "../../components/ui";
import { TradePanel } from "../../components/TradePanel";
import { EXPLORER_URL, TOKEN_DECIMALS } from "../../lib/config";

/// Samples slot0 as the screen is open. Arc testnet has no price history API,
/// so this is a live tape rather than a backfilled chart — labelled as such
/// instead of pretending to be a candlestick history.
function useLivePrice(pool?: Address, tokenIsToken0?: boolean) {
  const [series, setSeries] = useState<number[]>([]);
  useEffect(() => {
    if (!pool || tokenIsToken0 === undefined) return;
    let alive = true;
    const tick = async () => {
      try {
        const s = await client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" });
        if (alive) setSeries((p) => [...p.slice(-59), priceFromSqrt(s[0], tokenIsToken0)]);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [pool, tokenIsToken0]);
  return series;
}

function Spark({ data, w = 320, h = 90 }: { data: number[]; w?: number; h?: number }) {
  if (data.length < 2) {
    return (
      <View style={{ height: h, justifyContent: "center", alignItems: "center" }}>
        <Text style={{ fontFamily: font.mono, fontSize: 11, color: c.faint }}>
          sampling price… {data.length}/2
        </Text>
      </View>
    );
  }
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min;
  // A perfectly flat price makes span 0. Draw it down the middle rather than
  // pinned to the bottom, which reads as "broken" instead of "unchanged".
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = span === 0 ? h / 2 : h - ((v - min) / span) * (h - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");
  const up = data[data.length - 1] >= data[0];
  return (
    <Svg width={w} height={h}>
      <Line x1={0} y1={h - 4} x2={w} y2={h - 4} stroke={c.line} strokeWidth={1} />
      <Polyline points={pts} fill="none" stroke={up ? c.lime : c.pink} strokeWidth={2.5} strokeLinejoin="round" />
    </Svg>
  );
}

function Stat({ k, v, color = c.ink }: { k: string; v: string; color?: string }) {
  return (
    <View style={{ flex: 1, minWidth: "45%" }}>
      <Eyebrow>{k}</Eyebrow>
      <Text style={{ fontFamily: font.monoBold, fontSize: 15, color, marginTop: 4 }}>{v}</Text>
    </View>
  );
}

export default function TokenScreen() {
  const { address } = useLocalSearchParams<{ address: string }>();
  const [t, setT] = useState<TokenInfo | null>(null);
  const [isToken0, setIsToken0] = useState<boolean | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Every read here can fail on Arc's rate-limited public RPC. Without the
      // finally, one rejection leaves the screen spinning forever.
      try {
        const all = await fetchLaunches(50);
        const found = all.find((x) => x.token.toLowerCase() === String(address).toLowerCase()) ?? null;
        if (!alive) return;
        setT(found);
        if (found) {
          try {
            const t0 = await client.readContract({
              address: found.pool, abi: poolAbi, functionName: "token0",
            });
            if (alive) setIsToken0(t0.toLowerCase() === found.token.toLowerCase());
          } catch {
            // Orientation unknown: the price chart falls back to the board's
            // figure rather than blocking the whole page.
            if (alive) setIsToken0(undefined);
          }
        }
      } catch {
        if (alive) setT(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [address]);

  const series = useLivePrice(t?.pool, isToken0);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.void, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={c.lime} />
      </View>
    );
  }
  if (!t) {
    return (
      <View style={{ flex: 1, backgroundColor: c.void, padding: 20 }}>
        <Text style={{ fontFamily: font.mono, color: c.muted }}>Token not found on this launchpad.</Text>
      </View>
    );
  }

  const locked = countdown(t.unlockAt);
  const supply = Number(t.totalSupply) / 10 ** TOKEN_DECIMALS;
  const burned = Number(t.tokensBurned) / 10 ** TOKEN_DECIMALS;

  return (
    <>
      <Stack.Screen options={{ title: `$${t.symbol}` }} />
      <ScrollView style={{ flex: 1, backgroundColor: c.void }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Text style={{ fontFamily: font.display, fontSize: 32, color: c.ink }}>${t.symbol}</Text>
        <Text style={{ fontFamily: font.mono, fontSize: 14, color: c.muted, marginTop: 3 }}>{t.name}</Text>

        <View style={{ flexDirection: "row", gap: 7, marginTop: 14, flexWrap: "wrap" }}>
          <Tag label="LOCKED LP" />
          {t.buybackAndBurn ? <Tag label="BUY BACK & BURN" color={c.amber} /> : null}
          {t.creatorAllocation === 0n ? <Tag label="0% CREATOR" color={c.cyan} /> : null}
          {locked ? <Tag label={`UNLOCKS IN ${locked}`} color={c.pink} /> : null}
        </View>

        <View style={{ marginTop: 22 }}>
          <Card>
            <View style={{ padding: 16 }}>
              <Eyebrow>price · live from the pool</Eyebrow>
              <Text style={{ fontFamily: font.display, fontSize: 30, color: c.lime, marginTop: 4 }}>
                {usd(t.priceUsd)}
              </Text>
              <View style={{ marginTop: 12 }}>
                <Spark data={series} />
              </View>
            </View>
          </Card>
        </View>

        <View style={{ marginTop: 22 }}>
          <Card>
            <View style={{ padding: 16, flexDirection: "row", flexWrap: "wrap", rowGap: 18 }}>
              <Stat k="market cap" v={usd(t.marketCapUsd)} color={c.lime} />
              <Stat k="supply" v={supply.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
              <Stat k="age" v={ago(t.createdAt)} />
              <Stat k="pool" v={short(t.pool)} />
              {burned > 0 ? (
                <Stat k="burned" v={burned.toLocaleString(undefined, { maximumFractionDigits: 0 })} color={c.amber} />
              ) : null}
              <Stat k="creator" v={short(t.creator)} />
            </View>
          </Card>
        </View>

        <View style={{ marginTop: 22 }}>
          <TradePanel t={t} />
        </View>

        <Pressable onPress={() => Linking.openURL(`${EXPLORER_URL}/address/${t.token}`)} style={{ marginTop: 18 }}>
          <Text style={{ fontFamily: font.mono, fontSize: 12, color: c.cyan }}>View token on Arcscan ↗</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}
