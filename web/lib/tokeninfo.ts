/// Public description of a TSUKIPAD token, for wallets, bots and explorers.
///
/// Token logos and links live on-chain in each token's `metadataURI()`, packed
/// as a base64 data URI. That is self-contained, but it is not somewhere an
/// integrator would think to look, and decoding it is one more thing to build.
/// This turns it into the plain JSON and plain image URLs that integrations
/// expect, so a bot can show a TSUKIPAD token's logo without the creator paying
/// for a listing.
///
/// Membership is decided by the pads, never by the token: anyone can deploy a
/// contract whose `PAD()` says TSUKIPAD, but only a token the launchpad or the
/// curve actually launched has a record there.

import { getAddress, type Address } from "viem";

import { curveAbi, launchpadAbi, launchTokenAbi } from "./abi";
import {
  CURVE_ADDRESS,
  HOOK_ADDRESS,
  LAUNCHPAD_ADDRESS,
  POOL_FEE,
  POOL_MANAGER_ADDRESS,
  SITE_ORIGIN,
  TICK_SPACING,
  TOKEN_DEPLOYER_ADDRESS,
  USDC_ADDRESS,
  chain,
  isCurveDeployed,
} from "./config";
import { indexerClient } from "./indexer-rpc";
import { decodeMetadata } from "./metadata";
import { poolIdFor } from "./v4";

const ZERO_ID = `0x${"0".repeat(64)}`;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/// Base pool fee, in bps. Every TSUKIPAD pool and the curve both charge 1%.
const BASE_FEE_BPS = 100;

export type FeeMode = "creator" | "wallet" | "holders" | "buyback_burn" | "social_account";

export type TokenInfo = {
  schema: "tsukipad.token.v1";
  chainId: number;
  address: Address;
  name: string;
  symbol: string;
  decimals: 18;
  totalSupply: string;
  image: string | null;
  description: string | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  url: string;
  launchpad: {
    name: "TSUKIPAD";
    factory: Address;
    contract: Address;
    type: "direct" | "bonding_curve";
  };
  creator: Address;
  feeRecipient: Address | null;
  feeMode: FeeMode;
  createdAt: number;
  graduated: boolean;
  /// What a trade costs. `buyBps` and `sellBps` include the pool fee and the
  /// creator tax; the tax is charged by the hook, in USDC, and never changes.
  fees: {
    poolFeeBps: number;
    creatorTaxBps: number;
    buyBps: number;
    sellBps: number;
    taxCurrency: "USDC";
    immutable: true;
  };
  /// The Uniswap v4 pool, once the token trades in one. Null for a bonding
  /// curve that has not graduated yet.
  pool: {
    dex: "uniswap-v4";
    poolId: `0x${string}`;
    poolManager: Address;
    hook: Address;
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
  } | null;
};

/// Token metadata never changes once launched, and graduation is the only field
/// that moves. A short cache keeps a bot polling a hot token from turning every
/// request into five RPC calls.
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: TokenInfo | null; imageUri: string | null }>();

function clean(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/// Resolve a token, or null when TSUKIPAD did not launch it.
export async function tokenInfo(input: string): Promise<{ info: TokenInfo; imageUri: string | null } | null> {
  let address: Address;
  try {
    address = getAddress(input);
  } catch {
    return null;
  }
  const key = address.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value ? { info: hit.value, imageUri: hit.imageUri } : null;

  const pub = indexerClient();

  // Ask the pads. A revert means "not one of mine".
  const [direct, curve] = await Promise.all([
    pub
      .readContract({ address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, functionName: "launchOf", args: [address] })
      .catch(() => null),
    isCurveDeployed
      ? pub
          .readContract({ address: CURVE_ADDRESS, abi: curveAbi, functionName: "curveOf", args: [address] })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  if (!direct && !curve) {
    cache.set(key, { at: Date.now(), value: null, imageUri: null });
    return null;
  }

  const [name, symbol, totalSupply, metadataURI, rewardsEnabled] = await Promise.all([
    pub.readContract({ address, abi: launchTokenAbi, functionName: "name" }) as Promise<string>,
    pub.readContract({ address, abi: launchTokenAbi, functionName: "symbol" }) as Promise<string>,
    pub.readContract({ address, abi: launchTokenAbi, functionName: "totalSupply" }) as Promise<bigint>,
    pub.readContract({ address, abi: launchTokenAbi, functionName: "metadataURI" }) as Promise<string>,
    pub.readContract({ address, abi: launchTokenAbi, functionName: "rewardsEnabled" }) as Promise<boolean>,
  ]);

  const meta = decodeMetadata(metadataURI);
  const imageUri = clean(meta.image);
  const origin = SITE_ORIGIN.replace(/\/$/, "");

  let type: "direct" | "bonding_curve";
  let creator: Address;
  let recipient: Address;
  let createdAt: number;
  let graduated: boolean;
  let creatorTaxBps: number;
  let feeMode: FeeMode;
  let poolId: `0x${string}` | null;

  if (direct) {
    const l = direct as {
      pool: `0x${string}`; creator: Address; feeRecipient: Address; createdAt: bigint;
      buybackAndBurn: boolean; creatorTaxBps: number;
    };
    type = "direct";
    creator = l.creator;
    recipient = l.feeRecipient;
    createdAt = Number(l.createdAt);
    graduated = true;
    creatorTaxBps = Number(l.creatorTaxBps);
    poolId = l.pool;
    if (l.buybackAndBurn) feeMode = "buyback_burn";
    else if (rewardsEnabled) feeMode = "holders";
    else if (recipient === ZERO_ADDR) feeMode = "social_account";
    else if (recipient.toLowerCase() !== creator.toLowerCase()) feeMode = "wallet";
    else feeMode = "creator";
  } else {
    const c = curve as {
      pool: `0x${string}`; creator: Address; feeRecipient: Address; createdAt: bigint;
      graduated: boolean; creatorTaxBps: number;
    };
    type = "bonding_curve";
    creator = c.creator;
    recipient = c.feeRecipient;
    createdAt = Number(c.createdAt);
    graduated = c.graduated;
    creatorTaxBps = Number(c.creatorTaxBps);
    poolId = c.graduated && c.pool !== ZERO_ID ? c.pool : null;
    if (rewardsEnabled) feeMode = "holders";
    else if (recipient.toLowerCase() !== creator.toLowerCase()) feeMode = "wallet";
    else feeMode = "creator";
  }

  const info: TokenInfo = {
    schema: "tsukipad.token.v1",
    chainId: chain.id,
    address,
    name,
    symbol,
    decimals: 18,
    totalSupply: totalSupply.toString(),
    image: imageUri ? `${origin}/api/token/${address}/image` : null,
    description: clean(meta.description),
    website: clean(meta.website),
    twitter: clean(meta.twitter),
    telegram: clean(meta.telegram),
    url: `${origin}/token/${address}`,
    launchpad: {
      name: "TSUKIPAD",
      factory: TOKEN_DEPLOYER_ADDRESS,
      contract: type === "direct" ? LAUNCHPAD_ADDRESS : CURVE_ADDRESS,
      type,
    },
    creator,
    feeRecipient: recipient === ZERO_ADDR ? null : recipient,
    feeMode,
    createdAt,
    graduated,
    fees: {
      poolFeeBps: BASE_FEE_BPS,
      creatorTaxBps,
      buyBps: BASE_FEE_BPS + creatorTaxBps,
      sellBps: BASE_FEE_BPS + creatorTaxBps,
      taxCurrency: "USDC",
      immutable: true,
    },
    pool: poolId
      ? {
          dex: "uniswap-v4",
          // Recomputed from the key rather than trusted blindly, so a caller
          // can rebuild the exact PoolKey from these fields.
          poolId: poolIdFor(address),
          poolManager: POOL_MANAGER_ADDRESS,
          hook: HOOK_ADDRESS,
          currency0: address,
          currency1: USDC_ADDRESS,
          fee: POOL_FEE,
          tickSpacing: TICK_SPACING,
        }
      : null,
  };

  cache.set(key, { at: Date.now(), value: info, imageUri });
  return { info, imageUri };
}

/// Headers every public integration response carries: readable from any
/// origin, and cacheable at the edge so one popular token costs one read.
export const PUBLIC_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
} as const;
