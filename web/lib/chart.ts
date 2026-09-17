/// Market-cap candles for a token, built from every trade on-chain.
///
/// Two sources, because a token trades in two places over its life: the bonding
/// curve's own `Trade` events before graduation, and Uniswap's `Swap` events on
/// the PoolManager after it (or from the first block, for a direct launch). The
/// PoolManager is read rather than our router, so trades made through BasedBot,
/// Uniswap's interface or any other router are on the chart too.
///
/// Candles are one minute wide and kept in Redis, walked forward from the
/// token's launch a bounded number of chunks per request, the way the trade
/// tape is. Coarser timeframes are rolled up in the browser.

import { parseAbiItem, type Address } from "viem";

import { curveAbi } from "./abi";
import { CURVE_ADDRESS, MARKET_KEY_PREFIX, POOL_MANAGER_ADDRESS } from "./config";
import { getLogsSplit, indexerClient } from "./indexer-rpc";
import { cmd, redisConfigured } from "./redis";
import { tokenInfo } from "./tokeninfo";

/// [time (unix seconds, minute start), open, high, low, close, volume USD]
export type Candle = [number, number, number, number, number, number];

const SWAP = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);
const CURVE_TRADE = parseAbiItem(
  "event Trade(address indexed token, address indexed trader, bool isBuy, uint256 usdcAmount, uint256 tokenAmount, uint256 fee, uint256 tokensSold, uint256 usdcRaised)",
);

/// Arc's public RPC refuses ranges over 10,000 blocks.
const CHUNK = 9_000n;
/// Chunks read per request. A fresh token catches up in one request; a token
/// days old fills in over a handful of polls rather than one long timeout.
const CHUNKS_PER_REQUEST = 10;
/// ~5.5 days of one-minute candles. Older minutes fall off the front.
const MAX_CANDLES = 8_000;
/// Deliberately faster than Arc's real ~0.5s blocks, so the estimated launch
/// block lands before the launch rather than after it and no trade is missed.
const ASSUMED_BLOCK_SECONDS = 0.45;

type State = {
  v: 1;
  /// Next block to read.
  cursor: number;
  candles: Candle[];
  lastClose: number | null;
};

let curveCfg: { virtualUsdc: bigint; virtualTokens: bigint; totalSupply: bigint } | null = null;

async function curveConfig() {
  if (curveCfg) return curveCfg;
  const pub = indexerClient();
  const [virtualUsdc, virtualTokens, totalSupply] = await Promise.all([
    pub.readContract({ address: CURVE_ADDRESS, abi: curveAbi, functionName: "virtualUsdc" }) as Promise<bigint>,
    pub.readContract({ address: CURVE_ADDRESS, abi: curveAbi, functionName: "virtualTokens" }) as Promise<bigint>,
    pub.readContract({ address: CURVE_ADDRESS, abi: curveAbi, functionName: "TOTAL_SUPPLY" }) as Promise<bigint>,
  ]);
  curveCfg = { virtualUsdc, virtualTokens, totalSupply };
  return curveCfg;
}

type Point = { block: bigint; index: number; t: number; mcap: number; volume: number };

function addPoint(state: State, p: Point) {
  const minute = Math.floor(p.t / 60) * 60;
  const last = state.candles[state.candles.length - 1];
  if (last && last[0] === minute) {
    last[2] = Math.max(last[2], p.mcap);
    last[3] = Math.min(last[3], p.mcap);
    last[4] = p.mcap;
    last[5] += p.volume;
  } else if (!last || minute > last[0]) {
    // Open where the previous candle closed, so the chart reads as one
    // continuous price rather than a row of disconnected dashes.
    const open = state.lastClose ?? p.mcap;
    state.candles.push([minute, open, Math.max(open, p.mcap), Math.min(open, p.mcap), p.mcap, p.volume]);
    if (state.candles.length > MAX_CANDLES) state.candles.splice(0, state.candles.length - MAX_CANDLES);
  }
  state.lastClose = p.mcap;
}

export type ChartResult = {
  candles: Candle[];
  complete: boolean;
  openingMcap: number | null;
};

export async function chartFor(input: string): Promise<ChartResult | null> {
  const found = await tokenInfo(input);
  if (!found) return null;
  const info = found.info;
  const token = info.address as Address;
  const pub = indexerClient();
  const head = await pub.getBlockNumber();
  const supplyWhole = Number(BigInt(info.totalSupply) / 10n ** 18n);
  const isCurve = info.launchpad.type === "bonding_curve";

  const key = `${MARKET_KEY_PREFIX}chart:v1:${token.toLowerCase()}`;
  let state: State | null = null;
  if (redisConfigured) {
    try {
      const raw = await cmd<string | null>("GET", key);
      state = raw ? (JSON.parse(raw) as State) : null;
    } catch {
      state = null;
    }
  }
  if (!state) {
    const ago = Math.max(0, Date.now() / 1000 - info.createdAt);
    const back = BigInt(Math.ceil(ago / ASSUMED_BLOCK_SECONDS)) + CHUNK;
    state = { v: 1, cursor: Number(head > back ? head - back : 0n), candles: [], lastClose: null };
  }

  const cfg = isCurve ? await curveConfig() : null;
  const poolId = info.pool?.poolId ?? null;

  let budget = CHUNKS_PER_REQUEST;
  let from = BigInt(state.cursor);
  try {
    while (from <= head && budget > 0) {
      const to = from + CHUNK - 1n < head ? from + CHUNK - 1n : head;
      const [curveLogs, poolLogs] = await Promise.all([
        isCurve
          ? getLogsSplit(
              (lo, hi) => pub.getLogs({ address: CURVE_ADDRESS, event: CURVE_TRADE, args: { token }, fromBlock: lo, toBlock: hi }),
              from,
              to,
            )
          : Promise.resolve([]),
        poolId
          ? getLogsSplit(
              (lo, hi) => pub.getLogs({ address: POOL_MANAGER_ADDRESS, event: SWAP, args: { id: poolId }, fromBlock: lo, toBlock: hi }),
              from,
              to,
            )
          : Promise.resolve([]),
      ]);

      const points: Point[] = [];
      for (const log of curveLogs) {
        const a = log.args;
        const ts = (log as { blockTimestamp?: string | bigint }).blockTimestamp;
        if (!cfg || a.tokensSold === undefined || a.usdcRaised === undefined || a.usdcAmount === undefined || ts === undefined) continue;
        const price =
          (Number(cfg.virtualUsdc + a.usdcRaised) / 1e6) / (Number(cfg.virtualTokens + cfg.totalSupply - a.tokensSold) / 1e18);
        points.push({
          block: log.blockNumber ?? 0n, index: log.logIndex ?? 0, t: Number(ts),
          mcap: price * (Number(cfg.totalSupply) / 1e18), volume: Number(a.usdcAmount) / 1e6,
        });
      }
      for (const log of poolLogs) {
        const a = log.args;
        const ts = (log as { blockTimestamp?: string | bigint }).blockTimestamp;
        if (a.sqrtPriceX96 === undefined || a.amount1 === undefined || ts === undefined) continue;
        // token is currency0 (18dp), USDC currency1 (6dp): USDC per whole token.
        const ratio = Number(a.sqrtPriceX96) / 2 ** 96;
        const price = ratio * ratio * 1e12;
        const usdc = Number(a.amount1 < 0n ? -a.amount1 : a.amount1) / 1e6;
        points.push({ block: log.blockNumber ?? 0n, index: log.logIndex ?? 0, t: Number(ts), mcap: price * supplyWhole, volume: usdc });
      }
      points.sort((x, y) => (x.block === y.block ? x.index - y.index : x.block < y.block ? -1 : 1));
      for (const p of points) if (Number.isFinite(p.mcap) && p.mcap > 0) addPoint(state, p);

      from = to + 1n;
      state.cursor = Number(from);
      budget--;
    }
  } catch {
    // Keep what was read; the next request resumes from the saved cursor.
  }

  if (redisConfigured) {
    try {
      await cmd("SET", key, JSON.stringify(state), "EX", String(7 * 86_400));
    } catch {
      /* next request re-reads */
    }
  }

  const openingMcap = isCurve && cfg
    ? (Number(cfg.virtualUsdc) / 1e6) / (Number(cfg.virtualTokens + cfg.totalSupply) / 1e18) * (Number(cfg.totalSupply) / 1e18)
    : null;

  return { candles: state.candles, complete: BigInt(state.cursor) > head, openingMcap };
}
