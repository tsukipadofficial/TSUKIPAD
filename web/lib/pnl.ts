/// Position and profit accounting, kept pure so it can be tested without a chain.
///
/// Weighted-average cost, not FIFO. Both are defensible; average cost is what
/// every trading UI in this space shows, it needs one number per position rather
/// than a lot history, and it cannot disagree with itself when trades arrive out
/// of order -- which they will, because the indexer reads blocks in chunks.
///
/// Everything is integer. USDC is 6dp, tokens 18dp, and floats would drift a
/// little on every trade until somebody's realised profit was visibly wrong.

export type Position = {
  /// Tokens currently held, 18dp.
  tokens: bigint;
  /// What those tokens cost, 6dp. Falls proportionally as they are sold.
  costUsdc: bigint;
  /// Locked in by selling, 6dp, signed -- losses are real too.
  realizedUsdc: bigint;
  /// Lifetime totals, for volume and for showing an average entry.
  boughtUsdc: bigint;
  soldUsdc: bigint;
  tokensBought: bigint;
  trades: number;
};

export const EMPTY: Position = {
  tokens: 0n, costUsdc: 0n, realizedUsdc: 0n,
  boughtUsdc: 0n, soldUsdc: 0n, tokensBought: 0n, trades: 0,
};

export function applyBuy(p: Position, usdcIn: bigint, tokensOut: bigint): Position {
  return {
    ...p,
    tokens: p.tokens + tokensOut,
    costUsdc: p.costUsdc + usdcIn,
    boughtUsdc: p.boughtUsdc + usdcIn,
    tokensBought: p.tokensBought + tokensOut,
    trades: p.trades + 1,
  };
}

export function applySell(p: Position, tokensIn: bigint, usdcOut: bigint): Position {
  // Remove cost in proportion to the fraction of the position sold. Selling
  // more than we recorded means we missed their buy -- treat the whole basis as
  // consumed rather than inventing a cost for tokens we never saw arrive.
  const sold = tokensIn > p.tokens ? p.tokens : tokensIn;
  const costRemoved = p.tokens > 0n ? (p.costUsdc * sold) / p.tokens : 0n;

  return {
    ...p,
    tokens: p.tokens - sold,
    costUsdc: p.costUsdc - costRemoved,
    realizedUsdc: p.realizedUsdc + (usdcOut - costRemoved),
    soldUsdc: p.soldUsdc + usdcOut,
    trades: p.trades + 1,
  };
}

/// Current value of what is still held, 6dp. `priceUsdcPerToken` is scaled by
/// 1e18 so a sub-cent price survives integer division.
export function marketValue(p: Position, priceX18: bigint): bigint {
  return (p.tokens * priceX18) / 10n ** 18n / 10n ** 12n;
}

export function unrealized(p: Position, priceX18: bigint): bigint {
  return marketValue(p, priceX18) - p.costUsdc;
}

export function netPnl(p: Position, priceX18: bigint): bigint {
  return p.realizedUsdc + unrealized(p, priceX18);
}

/// Average entry in USDC per whole token, scaled by 1e18. Zero when nothing was
/// ever bought, rather than dividing by zero.
export function avgEntryX18(p: Position): bigint {
  if (p.tokensBought === 0n) return 0n;
  return (p.boughtUsdc * 10n ** 12n * 10n ** 18n) / p.tokensBought;
}
