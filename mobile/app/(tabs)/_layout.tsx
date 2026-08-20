import { Tabs } from "expo-router";
import { Text, View } from "react-native";
import { c, font } from "../../lib/theme";
import { LogoMark } from "../../components/Logo";

/// Glyph tab icons: a dependency-free icon font would be one more package to
/// keep in step with Expo, and these read fine at tab-bar size.
function Icon({ char, focused }: { char: string; focused: boolean }) {
  return (
    <Text style={{ fontFamily: font.monoBold, fontSize: 17, color: focused ? c.lime : c.faint }}>
      {char}
    </Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: c.void },
        headerTintColor: c.ink,
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: font.display, fontSize: 19 },
        tabBarStyle: {
          backgroundColor: c.void,
          borderTopWidth: 2,
          borderTopColor: c.line,
          height: 88,
          paddingTop: 8,
        },
        tabBarActiveTintColor: c.lime,
        tabBarInactiveTintColor: c.faint,
        tabBarLabelStyle: { fontFamily: font.monoMed, fontSize: 10, letterSpacing: 0.5 },
        sceneStyle: { backgroundColor: c.void },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Board",
          headerTitle: () => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
              <LogoMark size={22} />
              <Text style={{ fontFamily: font.display, fontSize: 19, color: c.ink }}>
                TSUKI<Text style={{ color: c.lime }}>PAD</Text>
              </Text>
            </View>
          ),
          tabBarIcon: ({ focused }) => <Icon char="▤" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{ title: "Wallet", tabBarIcon: ({ focused }) => <Icon char="◈" focused={focused} /> }}
      />
      <Tabs.Screen
        name="about"
        options={{ title: "About", tabBarIcon: ({ focused }) => <Icon char="月" focused={focused} /> }}
      />
    </Tabs>
  );
}
