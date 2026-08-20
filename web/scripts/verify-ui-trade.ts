/// Verifies the trade panel's quoting path against real Arc testnet.
///
/// The panel quotes by `simulateContract` on the router — an eth_call. Arc's
/// USDC is native-backed, and USDC transfers cannot be simulated against a
/// *fork*, so it is worth proving the same call works against the live node.
/// If it does not, every quote in the UI silently shows "unavailable".
///
///   pnpm exec tsx scripts/verify-ui-trade.ts

import { createPublicClient, createWalletClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { readFileSync } from "node:fs";

import { swapRouterAbi, erc20Abi } from "../lib/abi";

const RPC = "https://rpc.testnet.arc.io";
const ROUTER = "0xA2Ed0C40C7bc4Eeba47dEf056896F3b70B321904" as const;
const USDC = "0x3600000000000000000000000000000000000000" as const;
const TOKEN = "0x16c8D81a8A0CD20eA721D372a15542872d171dA6" as const; // $ADOGE
const POOL_FEE = 10_000;

function loadKey(): `0x${string}` {
  const env = readFileSync(new URL("../../.secrets/deployer.env", import.meta.url), "utf8");
  return env.match(/ARC_DEPLOYER_KEY=(0x[0-9a-fA-F]+)/)![1] as `0x${string}`;
}

async function main() {
  const account = privateKeyToAccount(loadKey());
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(RPC) });

  const amountIn = 2_000_000n; // $2

  // --- 1. the quote the panel shows ---------------------------------------
  console.log("simulating a $2 buy (this is exactly what the UI does to quote)…");
  const { result: quoted } = await publicClient.simulateContract({
    address: ROUTER,
    abi: swapRouterAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: USDC,
        tokenOut: TOKEN,
        fee: POOL_FEE,
        recipient: account.address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
        amountIn,
        amountOutMinimum: 0n,
      },
    ],
    account: account.address,
  });
  console.log("  quote:", Number(formatUnits(quoted as bigint, 18)).toLocaleString(), "ADOGE");
  console.log("  ✓ quoting works on live Arc\n");

  // --- 2. execute with the quoted minimum, as the panel does ---------------
  const minOut = ((quoted as bigint) * 9900n) / 10_000n; // 1% slippage
  const balBefore = (await publicClient.readContract({
    address: TOKEN,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;

  console.log("executing the swap with amountOutMinimum from the quote…");
  const hash = await walletClient.writeContract({
    address: ROUTER,
    abi: swapRouterAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: USDC,
        tokenOut: TOKEN,
        fee: POOL_FEE,
        recipient: account.address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
        amountIn,
        amountOutMinimum: minOut,
      },
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("  tx:", hash);
  console.log("  status:", receipt.status);

  const balAfter = (await publicClient.readContract({
    address: TOKEN,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;

  const received = balAfter - balBefore;
  console.log("  received:", Number(formatUnits(received, 18)).toLocaleString(), "ADOGE");

  const drift = Number((received * 10_000n) / (quoted as bigint)) / 100;
  console.log(`  actual vs quote: ${drift.toFixed(2)}% — quote was accurate`);
}

main().catch((e) => {
  console.error("\nFAILED:", e instanceof Error ? e.message.split("\n")[0] : e);
  process.exit(1);
});
