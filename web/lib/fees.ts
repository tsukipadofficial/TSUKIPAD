/// Fees a launch has earned but not yet collected.

const Q128 = 1n << 128n;
const MAX = (1n << 256n) - 1n;
const wrap = (x: bigint) => x & MAX;

/// Total owed to the position right now.
///
/// Uniswap credits a position's fees only when it is touched, so a pool that has
/// traded all week still reports nothing owed until then. What has accrued since
/// is the growth inside the position's range minus the growth already counted,
/// times the liquidity. On v4 the manager reports growth-inside directly, so
/// unlike the v3 version of this file there is no tick math to mirror here.
export function pendingFees(args: {
  liquidity: bigint;
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  feeGrowthInside0X128: bigint;
  feeGrowthInside1X128: bigint;
}): { token: bigint; usdc: bigint } {
  // The subtraction wraps at 2^256 on purpose: fee growth is a deliberately
  // overflowing accumulator and only the difference is meaningful.
  const accrued0 = (wrap(args.feeGrowthInside0X128 - args.feeGrowthInside0LastX128) * args.liquidity) / Q128;
  const accrued1 = (wrap(args.feeGrowthInside1X128 - args.feeGrowthInside1LastX128) * args.liquidity) / Q128;
  return { token: accrued0, usdc: accrued1 };
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
