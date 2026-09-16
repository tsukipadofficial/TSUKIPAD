import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

import { HOOK_ADDRESS, POOL_FEE, TICK_SPACING, USDC_ADDRESS } from "./config";

/// Uniswap v4 identities for a launch.
///
/// v4 has no pool contracts. Every pool lives inside the single pool manager and
/// is addressed by the hash of its key, so a launch that used to be "a pool at
/// 0x…" is now a key plus the id derived from it. The key is also what the
/// router and the quoter take, which is why it is built in one place.
///
/// The hook in the key is what charges the creator tax. Two pools over the same
/// pair with different hooks are different pools, so a launch's pool cannot be
/// impersonated by opening a hookless one.

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

/// Every launch token is mined to sort below USDC, so the token is always
/// currency0 and "buying" is always currency1 -> currency0.
export function poolKeyFor(token: Address): PoolKey {
  return {
    currency0: token,
    currency1: USDC_ADDRESS,
    fee: POOL_FEE,
    tickSpacing: TICK_SPACING,
    hooks: HOOK_ADDRESS as Address,
  };
}

const POOL_KEY_ABI = [
  {
    type: "tuple",
    components: [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" },
    ],
  },
] as const;

/// PoolId, exactly as the manager computes it: keccak of the abi-encoded key.
export function poolIdFor(token: Address): Hex {
  return keccak256(encodeAbiParameters(POOL_KEY_ABI, [poolKeyFor(token)]));
}

export function poolIdOfKey(key: PoolKey): Hex {
  return keccak256(encodeAbiParameters(POOL_KEY_ABI, [key]));
}
