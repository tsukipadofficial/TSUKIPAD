import { http, createConfig, createStorage, cookieStorage } from "wagmi";
import { injected } from "wagmi/connectors";
import { chain, RPC_URL } from "./config";

/// Injected-only by default: WalletConnect needs a project id, and Arc testnet
/// work is overwhelmingly MetaMask/Rabby. Add more connectors here if needed.
export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected()],
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
