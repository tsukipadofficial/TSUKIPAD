import { arc, arcTestnet } from "viem/chains";
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

/// Which Arc the whole app runs against. One switch, read at build time: chain,
/// default RPCs, explorer, faucet link and the testnet copy all follow it.
///
/// Defaults to testnet so that a deployment without the variable -- a preview,
/// a fresh clone -- can never quietly point real users at mainnet contracts.
export const IS_MAINNET = process.env.NEXT_PUBLIC_NETWORK === "mainnet";
const BASE_CHAIN = IS_MAINNET ? arc : arcTestnet;

/// Docs list rpc.testnet.arc.io; viem ships rpc.testnet.arc.network. Both resolve
/// to the same chain, and this is overridable for local anvil work.
///
/// Reads the app makes on a visitor's behalf -- balances, pool state, the board
/// -- go here. A managed provider is worth it: the public endpoint rate-limits
/// bursts, and a rate-limited read used to surface as "not a launch from this
/// pad" on a token that plainly existed.
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? (IS_MAINNET ? "https://rpc.mainnet.arc.io" : "https://rpc.testnet.arc.io");

/// Server-side endpoints for log scanning, which is a different problem.
///
/// The indexer walks history in 9,000-block chunks. Alchemy's free tier caps
/// eth_getLogs at *ten* blocks, which at Arc's ~169,000 blocks a day would need
/// ~16,900 calls per pool per day; Arc's public endpoints allow 10,000 per
/// call. So the managed provider serves visitors and the public ones serve the
/// indexer, which is the reverse of what you would guess.
///
/// A list, not one URL: every public endpoint rate-limits on its own schedule,
/// and a scan that hits a limit on one is simply retried on the next (see
/// `indexerTransport`). INDEXER_RPC_URL may hold several, comma-separated;
/// the chain's known public endpoints are always appended after it.
///
/// Never NEXT_PUBLIC_: these have no reason to reach a browser.
const PUBLIC_LOG_RPCS: Record<number, string[]> = {
  5042002: ["https://rpc.quicknode.testnet.arc.io", "https://rpc.testnet.arc.io"],
  5042: ["https://rpc.mainnet.arc.io"],
};
export const INDEXER_RPC_URLS: string[] = Array.from(new Set([
  ...(process.env.INDEXER_RPC_URL ?? "").split(",").map((u) => u.trim()).filter(Boolean),
  ...(PUBLIC_LOG_RPCS[BASE_CHAIN.id] ?? []),
]));

export const EXPLORER_URL = IS_MAINNET ? "https://explorer.arc.io" : "https://testnet.arcscan.app";
/// Only testnet USDC comes from a faucet. On mainnet there is nothing to link.
export const FAUCET_URL: string | null = IS_MAINNET ? null : "https://faucet.circle.com";

/// The chain, with its RPC pinned to RPC_URL.
///
/// Consumers that take a viem Chain rather than a transport -- Privy, and so
/// the embedded wallet it signs with -- would otherwise use whatever endpoint
/// viem ships, while wagmi used ours. One endpoint everywhere means one set of
/// limits and one thing to check when a transaction misbehaves.
/// Typed as a plain Chain: its id depends on the build-time network, and a
/// literal union of both ids would make every per-chain map demand both.
export const chain: Chain = {
  ...BASE_CHAIN,
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: IS_MAINNET ? "Arc Explorer" : "ArcScan", url: EXPLORER_URL },
  },
};

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

/// The bonding-curve launchpad. Separate from LAUNCHPAD_ADDRESS because it is a
/// separate contract: direct launches open straight into a pool, curve launches
/// trade on the curve until they sell out and graduate into one.
export const CURVE_ADDRESS = required(
  "NEXT_PUBLIC_CURVE_ADDRESS",
  process.env.NEXT_PUBLIC_CURVE_ADDRESS,
);

/// Uniswap v4. Every pool lives inside the one manager, so a launch is a pool
/// *key* rather than a pool address, prices are read through StateView, and
/// quotes come from the quoter. The hook is what charges the creator tax -- on
/// the curve and in the pool alike, which is the whole reason for v4 here.
export const POOL_MANAGER_ADDRESS = required(
  "NEXT_PUBLIC_POOL_MANAGER_ADDRESS",
  process.env.NEXT_PUBLIC_POOL_MANAGER_ADDRESS,
);

export const HOOK_ADDRESS = required("NEXT_PUBLIC_HOOK_ADDRESS", process.env.NEXT_PUBLIC_HOOK_ADDRESS);

/// Both pads deploy their tokens through this, so it -- not the pad -- is the
/// CREATE2 deployer a salt has to be mined against.
export const TOKEN_DEPLOYER_ADDRESS = required(
  "NEXT_PUBLIC_TOKEN_DEPLOYER_ADDRESS",
  process.env.NEXT_PUBLIC_TOKEN_DEPLOYER_ADDRESS,
);

export const STATE_VIEW_ADDRESS = required(
  "NEXT_PUBLIC_STATE_VIEW_ADDRESS",
  process.env.NEXT_PUBLIC_STATE_VIEW_ADDRESS,
);

export const QUOTER_ADDRESS = required("NEXT_PUBLIC_QUOTER_ADDRESS", process.env.NEXT_PUBLIC_QUOTER_ADDRESS);

/// Ceiling on the creator tax, mirroring TsukiHook.MAX_CREATOR_TAX_BPS. Read
/// from the hook where a live value matters; this is the form's default bound.
export const MAX_CREATOR_TAX_BPS = 1_000;

export const isCurveDeployed =
  CURVE_ADDRESS !== "0x0000000000000000000000000000000000000000";

/// Defaults the create form starts from.
export const DEFAULT_SUPPLY = 1_000_000_000n; // 1B whole tokens
export const DEFAULT_START_MCAP_USD = 2_500;
/// Top of a direct launch's liquidity range, as a multiple of the opening
/// market cap. 1,000,000x puts the ceiling near $2.5B from a $2.5K open, which
/// is the headroom a launch that runs needs; the tick it lands on is still far
/// inside Uniswap's bounds. Above the ceiling every token has been bought.
export const DEFAULT_CEILING_MULTIPLE = 1_000_000;
