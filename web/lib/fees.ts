/// Fees a launch has earned but not yet collected.
///
/// Uniswap credits a position's fees only when it is poked, so `tokensOwed` on
/// its own reads zero for a pool that has traded all week. The uncredited part
/// has to be derived from fee growth, which is what this does -- otherwise a
/// creator sees nothing owed right up until the moment they collect.
///
/// All arithmetic wraps at 2^256 on purpose: Uniswap stores fee growth as a
/// deliberately overflowing accumulator, and only the difference is meaningful.

import { keccak256, encodePacked, type Address } from "viem";

const Q128 = 1n << 128n;
const MAX = (1n << 256n) - 1n;
const wrap = (x: bigint) => x & MAX;

export type TickInfo = {
  feeGrowthOutside0X128: bigint;
  feeGrowthOutside1X128: bigint;
};

export type PositionInfo = {
  liquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
};

/// Uniswap's position key: owner, then the two ticks.
export function positionKey(owner: Address, tickLower: number, tickUpper: number): `0x${string}` {
  return keccak256(encodePacked(["address", "int24", "int24"], [owner, tickLower, tickUpper]));
}

function growthInside(
  global: bigint,
  lowerOutside: bigint,
  upperOutside: bigint,
  tickCurrent: number,
  tickLower: number,
  tickUpper: number,
): bigint {
  const below = tickCurrent >= tickLower ? lowerOutside : wrap(global - lowerOutside);
  const above = tickCurrent < tickUpper ? upperOutside : wrap(global - upperOutside);
  return wrap(global - below - above);
}

/// Total owed to the position right now: already credited, plus what has accrued
/// since the last poke.
export function pendingFees(args: {
  position: PositionInfo;
  lower: TickInfo;
  upper: TickInfo;
  feeGrowthGlobal0X128: bigint;
  feeGrowthGlobal1X128: bigint;
  tickCurrent: number;
  tickLower: number;
  tickUpper: number;
}): { token: bigint; usdc: bigint } {
  const { position: p, lower, upper, tickCurrent, tickLower, tickUpper } = args;

  const inside0 = growthInside(
    args.feeGrowthGlobal0X128, lower.feeGrowthOutside0X128, upper.feeGrowthOutside0X128,
    tickCurrent, tickLower, tickUpper,
  );
  const inside1 = growthInside(
    args.feeGrowthGlobal1X128, lower.feeGrowthOutside1X128, upper.feeGrowthOutside1X128,
    tickCurrent, tickLower, tickUpper,
  );

  const accrued0 = (wrap(inside0 - p.feeGrowthInside0LastX128) * p.liquidity) / Q128;
  const accrued1 = (wrap(inside1 - p.feeGrowthInside1LastX128) * p.liquidity) / Q128;

  return { token: p.tokensOwed0 + accrued0, usdc: p.tokensOwed1 + accrued1 };
}

/// How a collection would divide, given the launch's mode and the current rates.
/// Mirrors ArcLaunchpad.collectFees closely enough to preview a payout; the
/// chain remains the authority on the exact figures.
export function splitFees(args: {
  usdcSide: bigint;
  protocolFeeBps: number;
  referralBps: number;
  hasReferrer: boolean;
}): { creator: bigint; treasury: bigint; referrer: bigint } {
  const { usdcSide, protocolFeeBps, referralBps, hasReferrer } = args;
  const treasuryRaw = (usdcSide * BigInt(protocolFeeBps)) / 10_000n;
  const creator = usdcSide - treasuryRaw;
  let referrer = 0n;
  let treasury = treasuryRaw;
  if (hasReferrer && referralBps > 0) {
    referrer = (usdcSide * BigInt(referralBps)) / 10_000n;
    if (referrer > treasury) referrer = treasury;
    treasury -= referrer;
  }
  return { creator, treasury, referrer };
}
