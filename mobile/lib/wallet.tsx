import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import {
  PrivyProvider, usePrivy, useEmbeddedEthereumWallet, useLoginWithOAuth,
} from "@privy-io/expo";
import {
  createWalletClient, custom, type Address, type Abi,
} from "viem";
import { arcTestnet } from "./chain";
import { PRIVY_APP_ID, PRIVY_CLIENT_ID, privyConfigured } from "./privy";

type WalletApi = {
  address: Address | null;
  ready: boolean;
  connecting: boolean;
  connect: () => void;
  logout: () => void;
  writeContract: (args: {
    address: Address; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[];
  }) => Promise<`0x${string}`>;
};

const Ctx = createContext<WalletApi | null>(null);

/// Wraps Privy's embedded wallet in the small surface this app actually needs.
/// Signing goes through the wallet's EIP-1193 provider, which viem drives, so
/// there is no second transaction library to keep in step.
function WalletBridge({ children }: { children: React.ReactNode }) {
  const { user, isReady, logout } = usePrivy();
  const { wallets, create } = useEmbeddedEthereumWallet();
  const { login, state } = useLoginWithOAuth();
  const [connecting, setConnecting] = useState(false);

  const wallet = wallets?.[0] ?? null;
  const address = (wallet?.address as Address | undefined) ?? null;

  // A signed-in user with no wallet yet gets one created automatically, so
  // "sign in" and "have an address" are the same step from the user's side.
  useEffect(() => {
    if (isReady && user && (!wallets || wallets.length === 0)) {
      create().catch(() => {});
    }
  }, [isReady, user, wallets, create]);

  const connect = useCallback(() => {
    if (!privyConfigured) {
      Alert.alert("Not configured", "EXPO_PUBLIC_PRIVY_APP_ID is missing. See mobile/.env.example.");
      return;
    }
    setConnecting(true);
    login({ provider: "google" })
      .catch((e: any) => Alert.alert("Sign-in failed", e?.message ?? "Please try again."))
      .finally(() => setConnecting(false));
  }, [login]);

  const writeContract = useCallback<WalletApi["writeContract"]>(async (args) => {
    if (!wallet) throw new Error("No wallet connected");
    const provider = await wallet.getProvider();
    const client = createWalletClient({
      account: wallet.address as Address,
      chain: arcTestnet,
      transport: custom({ request: ({ method, params }) => provider.request({ method, params } as any) }),
    });
    return client.writeContract({
      address: args.address,
      abi: args.abi as Abi,
      functionName: args.functionName,
      args: args.args as any,
      chain: arcTestnet,
      account: wallet.address as Address,
    });
  }, [wallet]);

  const value = useMemo<WalletApi>(() => ({
    address,
    ready: isReady,
    connecting: connecting || state.status === "loading",
    connect,
    logout: () => { logout().catch(() => {}); },
    writeContract,
  }), [address, isReady, connecting, state.status, connect, logout, writeContract]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  // Without an app id Privy's provider throws on mount, which would take the
  // whole app down. Fall back to a null wallet so everything except trading
  // still works, and say so when the user taps Sign in.
  if (!privyConfigured) {
    const stub: WalletApi = {
      address: null, ready: true, connecting: false,
      connect: () => Alert.alert("Not configured",
        "Add EXPO_PUBLIC_PRIVY_APP_ID to mobile/.env — see .env.example."),
      logout: () => {},
      writeContract: async () => { throw new Error("Privy is not configured"); },
    };
    return <Ctx.Provider value={stub}>{children}</Ctx.Provider>;
  }
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      {...(PRIVY_CLIENT_ID ? { clientId: PRIVY_CLIENT_ID } : {})}
      supportedChains={[arcTestnet]}
    >
      <WalletBridge>{children}</WalletBridge>
    </PrivyProvider>
  );
}

export function useWallet(): WalletApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside <WalletProvider>");
  return v;
}
