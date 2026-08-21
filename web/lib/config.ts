import { arcTestnet } from "viem/chains";
import type { Address, Chain } from "viem";

/// Arc's USDC ERC20 interface. Note the decimals trap documented by Arc: the
/// *native* gas balance carries 18 decimals while this ERC20 view carries 6.
/// Everything in this app quotes USDC through the ERC20 view, at 6 decimals.
export const USDC_ADDRESS: Address = "0x3600000000000000000000000000000000000000";
export const USDC_DECIMALS = 6;
export const TOKEN_DECIMALS = 18;

/// 1% tier — appropriate for volatile launches, and its 200 tick spacing keeps
/// the wide launch range cheap to initialise.
export const POOL_FEE = 10_000;
export const TICK_SPACING = 200;

/// Docs list rpc.testnet.arc.io; viem ships rpc.testnet.arc.network. Both resolve
/// to the same chain, and this is overridable for local anvil work.
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.testnet.arc.io";

/// The chain, with its RPC pinned to RPC_URL.
///
/// Consumers that take a viem Chain rather than a transport -- Privy, and so
/// the embedded wallet it signs with -- would otherwise use whatever endpoint
/// viem ships, while wagmi used ours. One endpoint everywhere means one set of
/// limits and one thing to check when a transaction misbehaves.
export const chain = {
  ...arcTestnet,
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
} as const satisfies Chain;

/// Privy app id. Public by design -- it identifies the app to Privy's client
/// SDK and already ships in the browser bundle, so there is nothing to hide by
/// keeping it out of the repo. It is defaulted rather than left empty because
/// PrivyProvider throws on an invalid id during prerender, which breaks CI and
/// any fresh clone that has no .env.local.
///
/// The *app secret* is a different thing entirely: server-side only, and this
/// app never references it.
export const PRIVY_APP_ID =
  process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "cmt1u8i3r01v10dicbnswb0k4";

/// WalletConnect project id, also a public client identifier. Lets Privy offer
/// mobile wallets alongside injected ones.
export const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ??
  "df953ee3175df1a5b40eb420d24a34c0";

/// Where the app is served from, for links people share. Falls back to the
/// browser's own origin so preview deployments generate working links.
export const SITE_ORIGIN =
  typeof window !== "undefined" ? window.location.origin : "https://www.tsukipad.com";

export const EXPLORER_URL = "https://testnet.arcscan.app";
export const FAUCET_URL = "https://faucet.circle.com";

function required(name: string, value: string | undefined): Address {
  if (!value || !value.startsWith("0x")) {
    // Deliberately not throwing: the UI renders a "not deployed yet" state so
    // the app is browsable before contracts land on testnet.
    return "0x0000000000000000000000000000000000000000";
  }
  return value as Address;
}

export const LAUNCHPAD_ADDRESS = required(
  "NEXT_PUBLIC_LAUNCHPAD_ADDRESS",
  process.env.NEXT_PUBLIC_LAUNCHPAD_ADDRESS,
);

export const SWAP_ROUTER_ADDRESS = required(
  "NEXT_PUBLIC_SWAP_ROUTER_ADDRESS",
  process.env.NEXT_PUBLIC_SWAP_ROUTER_ADDRESS,
);

export const isDeployed =
  LAUNCHPAD_ADDRESS !== "0x0000000000000000000000000000000000000000";

/// Defaults the create form starts from.
export const DEFAULT_SUPPLY = 1_000_000_000n; // 1B whole tokens
export const DEFAULT_START_MCAP_USD = 3_000;
export const DEFAULT_CEILING_MULTIPLE = 10_000;
