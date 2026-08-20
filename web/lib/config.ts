import { arcTestnet } from "viem/chains";
import type { Address } from "viem";

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

export const chain = arcTestnet;

/// Docs list rpc.testnet.arc.io; viem ships rpc.testnet.arc.network. Both resolve
/// to the same chain, and this is overridable for local anvil work.
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.testnet.arc.io";

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
