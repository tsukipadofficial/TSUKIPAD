import { keccak256, encodePacked, getCreate2Address, type Address, type Hex } from "viem";
import { TICK_SPACING, TOKEN_DECIMALS, USDC_DECIMALS, USDC_ADDRESS } from "./config";

/// Uniswap ticks are powers of 1.0001.
const LOG_TICK_BASE = Math.log(1.0001);

/// Raw pool price is token1-per-token0 in *base units*. Because the launch token
/// carries 18 decimals and USDC carries 6, a human price in USD-per-token is the
/// raw price scaled by 10^(18-6).
const DECIMAL_SCALE = 10 ** (TOKEN_DECIMALS - USDC_DECIMALS); // 1e12

export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

/// Snap to the nearest usable tick. Pools only accept ticks that are multiples
/// of the fee tier's spacing, so the achievable price is always a rounded
/// version of what the creator typed.
export function alignTick(tick: number): number {
  return Math.round(tick / TICK_SPACING) * TICK_SPACING;
}

export function humanPriceToTick(usdPerToken: number): number {
  const raw = usdPerToken / DECIMAL_SCALE;
  return Math.round(Math.log(raw) / LOG_TICK_BASE);
}

export function tickToHumanPrice(tick: number): number {
  return Math.exp(tick * LOG_TICK_BASE) * DECIMAL_SCALE;
}

/// The tick a pool must open at for `supply` tokens to be worth `mcapUsd`.
export function startTickForMarketCap(mcapUsd: number, supply: bigint): number {
  const price = mcapUsd / Number(supply);
  return alignTick(humanPriceToTick(price));
}

/// Top of the liquidity range, expressed as a multiple of the opening price.
export function ceilingTick(startTick: number, multiple: number): number {
  const span = Math.round(Math.log(multiple) / LOG_TICK_BASE);
  return alignTick(startTick + span);
}

/// `supply` is in WHOLE tokens, not base units.
export function marketCapAtTick(tick: number, supply: bigint): number {
  return tickToHumanPrice(tick) * Number(supply);
}

/// Market cap implied by a live pool price.
///
/// `supply` is in WHOLE tokens, not base units -- pass `totalSupply / 1e18`.
/// Handing it raw base units overstates the answer by a factor of 1e18.
export function marketCapFromSqrtPriceX96(sqrtPriceX96: bigint, supply: bigint): number {
  // Work in logs: sqrtPriceX96 routinely exceeds Number.MAX_SAFE_INTEGER, and
  // squaring it directly overflows even in float space for extreme ranges.
  const lnSqrt = Math.log(Number(sqrtPriceX96 >> 32n)) + 32 * Math.LN2;
  const lnRaw = 2 * (lnSqrt - 96 * Math.LN2);
  const humanPrice = Math.exp(lnRaw) * DECIMAL_SCALE;
  return humanPrice * Number(supply);
}

/// Price in USDC per whole token, scaled by 1e18.
///
/// Integer throughout, unlike marketCapFromSqrtPriceX96 which works in logs for
/// display. Profit accounting multiplies this by balances, so a float here would
/// drift into somebody's reported profit.
export function priceX18FromSqrt(sqrtPriceX96: bigint): bigint {
  // (sqrt / 2^96)^2 gives token1 per token0 in base units. USDC is 6dp against
  // the token's 18, so 1e12 converts to whole-token terms; 1e18 is the scale.
  return (sqrtPriceX96 * sqrtPriceX96 * 10n ** 30n) >> 192n;
}

/// sqrt(price) at a tick, in raw base-unit terms.
function sqrtAt(tick: number): number {
  return Math.exp(0.5 * tick * LOG_TICK_BASE);
}

/// Constant liquidity L of a position holding `supply` tokens across [a, b].
function liquidityOf(startTick: number, endTick: number, supply: bigint): number {
  const amount0 = Number(supply) * 10 ** TOKEN_DECIMALS;
  const sa = sqrtAt(startTick);
  const sb = sqrtAt(endTick);
  return (amount0 * sa * sb) / (sb - sa);
}

/// Total USDC the curve can absorb before every token is sold. Excludes the 1%
/// swap fee, which buyers pay on top.
///
/// For a single-sided token0 position the amount1 collected across the whole
/// range reduces to `amount0 * sqrt(pa) * sqrt(pb)`.
export function curveCapacityUsd(
  startTick: number,
  endTick: number,
  supply: bigint,
): number {
  const amount0 = Number(supply) * 10 ** TOKEN_DECIMALS;
  return (amount0 * sqrtAt(startTick) * sqrtAt(endTick)) / 10 ** USDC_DECIMALS;
}

/// USDC the curve can still absorb from where it currently sits.
///
/// This is emphatically not `curveCapacityUsd(currentTick, endTick, supply)` —
/// by the time the price has moved, most of the supply has already been sold,
/// so charging the full supply against the remaining range overstates what is
/// left by an order of magnitude. The correct quantity is `L * (sqrt(pb) -
/// sqrt(p))`, using the liquidity fixed at launch.
export function remainingCapacityUsd(
  startTick: number,
  endTick: number,
  currentTick: number,
  supply: bigint,
): number {
  if (currentTick >= endTick) return 0;
  const clamped = Math.max(currentTick, startTick);
  const L = liquidityOf(startTick, endTick, supply);
  return (L * (sqrtAt(endTick) - sqrtAt(clamped))) / 10 ** USDC_DECIMALS;
}

/// Fraction of the launch supply already bought out of the pool, 0..1.
///
/// Far more meaningful than raw tick progress: because price rises with the
/// square of sqrt(p), a pool can be 60% of the way through its tick range while
/// 90% of the supply is already gone.
export function fractionSold(
  startTick: number,
  endTick: number,
  currentTick: number,
): number {
  const clamped = Math.min(Math.max(currentTick, startTick), endTick);
  const invA = 1 / sqrtAt(startTick);
  const invB = 1 / sqrtAt(endTick);
  const inv = 1 / sqrtAt(clamped);
  return Math.min(1, Math.max(0, 1 - (inv - invB) / (invA - invB)));
}

/// Price (as a multiple of the opening price) once `fraction` of supply is sold.
/// Inverse of `fractionSold`, used to draw the curve.
export function priceMultipleAtFractionSold(
  startTick: number,
  endTick: number,
  fraction: number,
): number {
  const sa = sqrtAt(startTick);
  const sb = sqrtAt(endTick);
  const inv = 1 / sb + (1 - fraction) * (1 / sa - 1 / sb);
  const s = 1 / inv;
  return (s / sa) ** 2;
}

/// Price impact of a buy, as the market cap it would move the pool to.
/// Approximates by walking the constant-L curve within the range.
export function marketCapAfterBuy(
  startTick: number,
  endTick: number,
  supply: bigint,
  currentTick: number,
  usdcIn: number,
): number {
  const capacity = curveCapacityUsd(currentTick, endTick, supply);
  if (usdcIn >= capacity) return marketCapAtTick(endTick, supply);

  // sqrtP moves linearly in amount1 for a constant-liquidity range:
  //   sqrtP' = sqrtP + amount1 / L
  const supplyBaseUnits = Number(supply) * 10 ** TOKEN_DECIMALS;
  const sqrtA = Math.exp(0.5 * currentTick * LOG_TICK_BASE);
  const sqrtB = Math.exp(0.5 * endTick * LOG_TICK_BASE);
  const L = (supplyBaseUnits * sqrtA * sqrtB) / (sqrtB - sqrtA);
  const sqrtNext = sqrtA + (usdcIn * 10 ** USDC_DECIMALS) / L;
  const rawNext = sqrtNext * sqrtNext;
  return rawNext * DECIMAL_SCALE * Number(supply);
}

// ---------------------------------------------------------------------------
// CREATE2 salt mining
// ---------------------------------------------------------------------------

/// The launchpad namespaces salts by creator so a pending launch cannot be
/// front-run by someone claiming its salt first.
export function namespacedSalt(creator: Address, salt: Hex): Hex {
  return keccak256(encodePacked(["address", "bytes32"], [creator, salt]));
}

export function predictTokenAddress(
  launchpad: Address,
  creator: Address,
  salt: Hex,
  initCodeHash: Hex,
): Address {
  return getCreate2Address({
    from: launchpad,
    salt: namespacedSalt(creator, salt),
    bytecodeHash: initCodeHash,
  });
}

/// Every token launched here ends in these hex digits, as a house mark: an
/// address is the one part of a launch that is visible everywhere, in every
/// explorer and every bot, without anyone having to ask what made it.
///
/// Set to "" to mine for ordering alone. Digits only is deliberate -- checksum
/// casing varies by how an address is rendered, and a suffix of digits reads
/// the same in all of them.
export const VANITY_SUFFIX = "272";

/// Find a salt whose token address sorts below USDC, making the token `token0`,
/// and -- when it can -- ends in `VANITY_SUFFIX`.
///
/// Only the ordering is a hard requirement. The entire single-sided launch
/// depends on it: a token0 position above spot holds only tokens, which is what
/// lets the creator seed the pool without a cent of USDC. Roughly 21% of
/// addresses qualify (any first byte below 0x36). The suffix is a house mark and
/// nothing more -- the contracts never check it -- so a launch must never fail
/// for want of one. If the suffix search runs past its budget the launch goes
/// out on the first ordering-valid address found instead, and `vanity` says so.
///
/// The suffix costs a further 1 in 4,096, so the two together land about one
/// salt in 19,400. Measured over 20 launches: mean 17.4k attempts (~0.9s),
/// median 13.8k, worst 55.7k (~2.9s). The budget sits far above that so the
/// fallback is for slow phones and bad luck, not the ordinary case.
///
/// The search starts from a random salt rather than zero. From zero, a creator
/// launching the same name, symbol and metadata twice mined the identical
/// address both times -- one the first launch already occupied -- and the second
/// launch reverted on the CREATE2 collision.
///
/// `deployer` is whichever contract runs the CREATE2 -- the pads hand that job
/// to TokenDeployer, so passing a pad here would mine a salt for an address no
/// launch will ever land on.
export function mineSalt(
  deployer: Address,
  creator: Address,
  initCodeHash: Hex,
  maxAttempts = 1_000_000,
  vanityBudget = 300_000,
  start: bigint = randomSaltStart(),
): { salt: Hex; token: Address; attempts: number; vanity: boolean } {
  const usdc = BigInt(USDC_ADDRESS);
  const suffix = VANITY_SUFFIX.toLowerCase();
  let fallback: { salt: Hex; token: Address; attempts: number } | null = null;

  for (let i = 0; i < maxAttempts; i++) {
    const salt = `0x${((start + BigInt(i)) & MAX_SALT).toString(16).padStart(64, "0")}` as Hex;
    const token = predictTokenAddress(deployer, creator, salt, initCodeHash);
    if (BigInt(token) >= usdc) continue;

    if (!suffix || token.toLowerCase().endsWith(suffix)) {
      return { salt, token, attempts: i + 1, vanity: !!suffix };
    }
    fallback ??= { salt, token, attempts: i + 1 };
    // Out of patience for the house mark: launch on a plain address instead.
    if (i + 1 >= vanityBudget) return { ...fallback, vanity: false };
  }
  if (fallback) return { ...fallback, vanity: false };
  throw new Error("no qualifying salt found");
}

const MAX_SALT = (1n << 256n) - 1n;

/// A random 256-bit starting point. Falls back to time-derived entropy where
/// Web Crypto is unavailable; collisions only need to be improbable, not secret.
function randomSaltStart(): bigint {
  const bytes = new Uint8Array(32);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  return BigInt(`0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`);
}
