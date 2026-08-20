import { View, Text, ScrollView, Pressable, Linking } from "react-native";
import { c, font } from "../../lib/theme";
import { Card, Eyebrow } from "../../components/ui";
import { LogoMark } from "../../components/Logo";
import { LAUNCHPAD_ADDRESS, CHAIN_ID, EXPLORER_URL } from "../../lib/config";
import { short } from "../../lib/format";

const STEPS = [
  ["01", "You pick a name, ticker and ceiling"],
  ["02", "The token deploys to a CREATE2 address"],
  ["03", "A real Uniswap V3 pool opens, paired with USDC"],
  ["04", "Liquidity is seeded with your token alone"],
];

function Link({ label, url }: { label: string; url: string }) {
  return (
    <Pressable onPress={() => Linking.openURL(url)} style={{ paddingVertical: 11 }}>
      <Text style={{ fontFamily: font.mono, fontSize: 14, color: c.cyan }}>{label} ↗</Text>
    </Pressable>
  );
}

export default function About() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.void }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 13, marginBottom: 8 }}>
        <LogoMark size={46} />
        <View>
          <Text style={{ fontFamily: font.display, fontSize: 26, color: c.ink }}>
            TSUKI<Text style={{ color: c.lime }}>PAD</Text>
            <Text style={{ color: c.limeDim, fontSize: 18 }}>  月</Text>
          </Text>
          <Text style={{ fontFamily: font.mono, fontSize: 12, color: c.muted, marginTop: 2 }}>
            fair launches on Arc Network
          </Text>
        </View>
      </View>

      <Text style={{ fontFamily: font.mono, fontSize: 14, lineHeight: 22, color: c.muted, marginTop: 18 }}>
        Tokens open directly into a real Uniswap V3 pool paired with USDC. The
        pool is seeded entirely with the token itself, so the creator supplies no
        liquidity. No presale, no bonding curve, no graduation step.
      </Text>

      <Eyebrow style={{ marginTop: 30, marginBottom: 12 }}>how a launch works</Eyebrow>
      {STEPS.map(([n, s]) => (
        <View key={n} style={{ marginBottom: 10 }}>
          <Card>
            <View style={{ padding: 14, flexDirection: "row", gap: 13, alignItems: "center" }}>
              <Text style={{ fontFamily: font.monoBold, fontSize: 13, color: c.lineBright }}>{n}</Text>
              <Text style={{ flex: 1, fontFamily: font.mono, fontSize: 13, color: c.ink }}>{s}</Text>
            </View>
          </Card>
        </View>
      ))}

      <Eyebrow style={{ marginTop: 26, marginBottom: 6 }}>network</Eyebrow>
      <Card>
        <View style={{ padding: 14, gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontFamily: font.mono, fontSize: 12, color: c.faint }}>chain</Text>
            <Text style={{ fontFamily: font.mono, fontSize: 12, color: c.ink }}>Arc Testnet · {CHAIN_ID}</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontFamily: font.mono, fontSize: 12, color: c.faint }}>launchpad</Text>
            <Text style={{ fontFamily: font.mono, fontSize: 12, color: c.ink }}>{short(LAUNCHPAD_ADDRESS)}</Text>
          </View>
        </View>
      </Card>

      <Eyebrow style={{ marginTop: 26 }}>links</Eyebrow>
      <Link label="tsukipad.com" url="https://www.tsukipad.com" />
      <Link label="Launch a token (opens the site)" url="https://www.tsukipad.com/create" />
      <Link label="X — @tsukipad_" url="https://x.com/tsukipad_" />
      <Link label="Telegram" url="https://t.me/tsukipadofficial" />
      <Link label="Contracts on Arcscan" url={`${EXPLORER_URL}/address/${LAUNCHPAD_ADDRESS}`} />

      <Text style={{ fontFamily: font.mono, fontSize: 11, lineHeight: 18, color: c.faint, marginTop: 28 }}>
        Arc is a trademark of Circle Internet Group, Inc. This project is not
        affiliated with or endorsed by Circle. Testnet only. Not audited.
      </Text>
    </ScrollView>
  );
}
