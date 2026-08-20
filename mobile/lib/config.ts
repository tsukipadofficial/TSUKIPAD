import type { Address } from "viem";

export const CHAIN_ID = 5042002;
export const RPC_URL = "https://rpc.testnet.arc.io";
export const EXPLORER_URL = "https://testnet.arcscan.app";

/// Arc's USDC ERC20 view carries 6 decimals; the native gas balance carries 18.
/// Everything here quotes the ERC20 view.
export const USDC_ADDRESS: Address = "0x3600000000000000000000000000000000000000";
export const USDC_DECIMALS = 6;
export const TOKEN_DECIMALS = 18;

export const POOL_FEE = 10_000;

/// Deployed addresses, mirroring contracts/deployments/5042002.json.
export const LAUNCHPAD_ADDRESS: Address = "0xaaC3C3D386E5328f3aC91146d57C1F80EB00C3a5";
export const SWAP_ROUTER_ADDRESS: Address = "0x905e2454f1e140B8fcF852F60B917b8992841A68";
