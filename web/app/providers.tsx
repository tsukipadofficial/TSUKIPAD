"use client";

import { useState, type ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { wagmiConfig } from "@/lib/wagmi";
import { chain, PRIVY_APP_ID, WALLETCONNECT_PROJECT_ID } from "@/lib/config";
import { I18nProvider } from "@/lib/i18n";

export function Providers({ children }: { children: ReactNode }) {
  // One client per mount, so SSR and client never share cache instances.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  const tree = (
    <QueryClientProvider client={queryClient}>
      {/* WagmiProvider must sit inside both PrivyProvider and the query client. */}
      <WagmiProvider config={wagmiConfig}>
        <I18nProvider>{children}</I18nProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );

  // PrivyProvider always renders: making it conditional would force every
  // consumer of usePrivy() into a conditional hook call. A missing app id is a
  // misconfiguration and should fail loudly rather than silently degrade.
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // 'twitter' is X. Order here is the order shown in the modal.
        loginMethods: ["email", "google", "twitter", "github", "discord", "wallet"],
        appearance: {
          theme: "dark",
          accentColor: "#c8ff2e", // --color-lime
          walletChainType: "ethereum-only",
          showWalletLoginFirst: false,
        },
        // Social and email users arrive without a wallet; minting one on login
        // is what lets them sign the waitlist message like any other user.
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        defaultChain: chain,
        supportedChains: [chain],
        ...(WALLETCONNECT_PROJECT_ID
          ? { walletConnectCloudProjectId: WALLETCONNECT_PROJECT_ID }
          : {}),
      }}
    >
      {tree}
    </PrivyProvider>
  );
}
