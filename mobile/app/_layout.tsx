// Privy's crypto path needs these before anything else loads: React Native
// has no Web Crypto, no TextEncoder and no Buffer by default.
import "fast-text-encoding";
import "react-native-get-random-values";
import "@ethersproject/shims";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from "@expo-google-fonts/jetbrains-mono";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Splash } from "../components/Splash";
import { WalletProvider } from "../lib/wallet";
import { c } from "../lib/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [introDone, setIntroDone] = useState(false);
  const [loaded] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  if (!loaded) return <View style={{ flex: 1, backgroundColor: c.void }} />;

  return (
    <WalletProvider>
      <StatusBar style="light" />
      {introDone ? null : <Splash onDone={() => setIntroDone(true)} />}
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: c.void },
          headerTintColor: c.ink,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: c.void },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="token/[address]" options={{ title: "", headerBackTitle: "Board" }} />
      </Stack>
    </WalletProvider>
  );
}
