import { http, createStorage, cookieStorage } from "wagmi";
import { createConfig } from "@privy-io/wagmi";
import { chain, RPC_URL } from "./config";

/// `createConfig` comes from @privy-io/wagmi, not wagmi, so Privy can drive
/// wagmi's connector state. Connectors are deliberately absent: Privy supplies
/// them (injected, WalletConnect, and the embedded wallet it mints for users
/// who sign in with email or a social account).
export const wagmiConfig = createConfig({
  chains: [chain],
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  transports: {
    [chain.id]: http(RPC_URL, { batch: true }),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
