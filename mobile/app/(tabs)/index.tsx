import { useCallback, useEffect, useState } from "react";
import {
  View, Text, FlatList, RefreshControl, Pressable, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { c, font } from "../../lib/theme";
import { fetchLaunches, type TokenInfo } from "../../lib/chain";
import { usd, ago, countdown } from "../../lib/format";
import { Card, Eyebrow, Tag } from "../../components/ui";

function Row({ t, onPress }: { t: TokenInfo; onPress: () => void }) {
  const locked = countdown(t.unlockAt);
  return (
    <Pressable onPress={onPress} style={{ marginBottom: 14 }}>
      {({ pressed }) => (
        <Card style={{ opacity: pressed ? 0.75 : 1 }}>
          <View style={{ padding: 15 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontFamily: font.display, fontSize: 19, color: c.ink }}>
                    ${t.symbol}
                  </Text>
                  <Text style={{ fontFamily: font.mono, fontSize: 12, color: c.faint }}>
                    {ago(t.createdAt)}
                  </Text>
                </View>
                <Text
                  numberOfLines={1}
                  style={{ fontFamily: font.mono, fontSize: 13, color: c.muted, marginTop: 3 }}
                >
                  {t.name}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Eyebrow>mcap</Eyebrow>
                <Text
                  style={{ fontFamily: font.monoBold, fontSize: 17, color: c.lime, marginTop: 2 }}
                >
                  {usd(t.marketCapUsd)}
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: "row", gap: 7, marginTop: 13, flexWrap: "wrap" }}>
              <Tag label="LOCKED LP" />
              {t.buybackAndBurn ? <Tag label="BURN" color={c.amber} /> : null}
              {t.creatorAllocation === 0n ? (
                <Tag label="0% CREATOR" color={c.cyan} />
              ) : locked ? (
                <Tag label={`UNLOCKS ${locked}`} color={c.pink} />
              ) : null}
            </View>
          </View>
        </Card>
      )}
    </Pressable>
  );
}

export default function Board() {
  const router = useRouter();
  const [data, setData] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setErr(null);
      setData(await fetchLaunches());
    } catch (e: any) {
      setErr(e?.shortMessage ?? e?.message ?? "Could not reach Arc testnet");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: c.void }}>
        <ActivityIndicator color={c.lime} />
        <Text style={{ fontFamily: font.mono, color: c.faint, marginTop: 12, fontSize: 12 }}>
          reading Arc testnet…
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: c.void }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      data={data}
      keyExtractor={(t) => t.token}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={c.lime}
          onRefresh={() => { setRefreshing(true); load(); }}
        />
      }
      ListHeaderComponent={
        <View style={{ marginBottom: 16 }}>
          <Eyebrow>{err ? "connection" : `${data.length} launches · live`}</Eyebrow>
          {err ? (
            <Text style={{ fontFamily: font.mono, color: c.pink, fontSize: 12, marginTop: 6 }}>
              {err}
            </Text>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <Text style={{ fontFamily: font.mono, color: c.faint, fontSize: 13 }}>
          No launches yet.
        </Text>
      }
      renderItem={({ item }) => (
        <Row t={item} onPress={() => router.push(`/token/${item.token}`)} />
      )}
    />
  );
}
