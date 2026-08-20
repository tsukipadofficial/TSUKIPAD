import { createPublicClient, defineChain, http, type Address } from "viem";
import { CHAIN_ID, RPC_URL, USDC_ADDRESS, USDC_DECIMALS, TOKEN_DECIMALS } from "./config";
import { launchpadAbi, erc20Abi, poolAbi } from "./abi";
import { LAUNCHPAD_ADDRESS } from "./config";

export const arcTestnet = defineChain({
  id: CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
});

export const client = createPublicClient({
  chain: arcTestnet,
  // Arc's public RPC intermittently answers "Request exceeds defined limit"
  // under bursts. Batching made it worse, so each read goes on its own
  // request, throttled by mapLimit below and retried with backoff.
  transport: http(RPC_URL, { batch: false, retryCount: 3, retryDelay: 400 }),
});

export type Launch = {
  token: Address; pool: Address; creator: Address;
  createdAt: bigint; liquidity: bigint;
  creatorAllocation: bigint; unlockAt: bigint;
  buybackAndBurn: boolean; tokensBurned: bigint;
};

export type TokenInfo = Launch & {
  name: string; symbol: string; totalSupply: bigint;
  priceUsd: number; marketCapUsd: number;
};

/// USDC has 6 decimals and the token 18, so the raw sqrt price has to be
/// rescaled by 10^(18-6) before it means anything in dollars.
export function priceFromSqrt(sqrtPriceX96: bigint, tokenIsToken0: boolean): number {
  const Q96 = 2 ** 96;
  const sp = Number(sqrtPriceX96) / Q96;
  const raw = sp * sp; // token1 per token0
  const scale = 10 ** (TOKEN_DECIMALS - USDC_DECIMALS);
  return tokenIsToken0 ? raw * scale : (1 / raw) * scale;
}

/// Runs `job` over `items` with at most `n` in flight. Arc's RPC rejects
/// oversized JSON-RPC batches, and a 30-token board is 150 reads.
async function mapLimit<T, R>(items: T[], n: number, job: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await job(items[k]);
      }
    }),
  );
  return out;
}

export async function fetchLaunches(limit = 30): Promise<TokenInfo[]> {
  const count = await client.readContract({
    address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, functionName: "launchCount",
  });
  if (count === 0n) return [];

  const page = await client.readContract({
    address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, functionName: "recentLaunches",
    args: [0n, BigInt(Math.min(limit, Number(count)))],
  });

  const details = await mapLimit([...page], 2, async (l) => {
    try {
      const [name, symbol, totalSupply, slot0, token0] = await Promise.all([
        client.readContract({ address: l.token, abi: erc20Abi, functionName: "name" }),
        client.readContract({ address: l.token, abi: erc20Abi, functionName: "symbol" }),
        client.readContract({ address: l.token, abi: erc20Abi, functionName: "totalSupply" }),
        client.readContract({ address: l.pool, abi: poolAbi, functionName: "slot0" }),
        client.readContract({ address: l.pool, abi: poolAbi, functionName: "token0" }),
      ]);
      const isToken0 = token0.toLowerCase() === l.token.toLowerCase();
      const priceUsd = priceFromSqrt(slot0[0], isToken0);
      const supply = Number(totalSupply) / 10 ** TOKEN_DECIMALS;
      return { ...l, name, symbol, totalSupply, priceUsd, marketCapUsd: priceUsd * supply } as TokenInfo;
    } catch {
      // Keep the launch on the board rather than silently vanishing it; the
      // row renders without a price instead of the token disappearing.
      return {
        ...l, name: "", symbol: l.token.slice(2, 8).toUpperCase(),
        totalSupply: 0n, priceUsd: 0, marketCapUsd: 0,
      } as TokenInfo;
    }
  });
  return details;
}

export async function fetchUsdcBalance(addr: Address): Promise<number> {
  const bal = await client.readContract({
    address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [addr],
  });
  return Number(bal) / 10 ** USDC_DECIMALS;
}
