/// Continues the NFT launch test: trade both ways, collect, verify escrow.
/// Paced deliberately -- the public RPC answers bursts with
/// "Request exceeds defined limit", which is a rate limit wearing a confusing name.

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { readFileSync } from "node:fs";

import { launchpadAbi, swapRouterAbi, erc20Abi } from "../lib/abi";

const RPC = "https://rpc.testnet.arc.io";
const LAUNCHPAD = "0x0887CB9E7Da9488055F62800d22Ad2aAB57e4504" as const;
const ROUTER = "0x5920274784685bEF0Ad09C18c2380f9244882c09" as const;
const USDC = "0x3600000000000000000000000000000000000000" as const;
const TOKEN = "0x21659D1A81284B1b84fd7FB176A8479538cC1A1d" as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usd = (v: bigint) => `$${formatUnits(v, 6)}`;

function loadKey(): `0x${string}` {
  const env = readFileSync(new URL("../../.secrets/deployer.env", import.meta.url), "utf8");
  return env.match(/ARC_DEPLOYER_KEY=(0x[0-9a-fA-F]+)/)![1] as `0x${string}`;
}

/// Retry the rate limiter rather than fail the run over it.
async function retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 6; i++) {
    try {
      return await fn();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (!/exceeds defined limit|rate limit|429/i.test(m)) throw e;
      await sleep(4000 * (i + 1));
    }
  }
  throw new Error(`${label}: still rate limited after retries`);
}

async function main() {
  const account = privateKeyToAccount(loadKey());
  const pub = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(RPC) });
  const read = (fn: string, args: unknown[] = []) =>
    retry(fn, () => pub.readContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: fn as never, args: args as never }));

  const before = (await read("launchOf", [TOKEN])) as { feeRecipient: string; pool: string };
  console.log("token       ", TOKEN);
  console.log("pool        ", before.pool);
  console.log("feeRecipient", before.feeRecipient, "(zero = earmarked, unclaimed)\n");

  const spend = parseUnits("4", 6);
  await sleep(2000);
  await retry("approve usdc", async () =>
    pub.waitForTransactionReceipt({
      hash: await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [ROUTER, spend] }),
    }));
  await sleep(3000);
  await retry("buy", async () =>
    pub.waitForTransactionReceipt({
      hash: await wallet.writeContract({
        address: ROUTER, abi: swapRouterAbi, functionName: "exactInputSingle",
        args: [{ tokenIn: USDC, tokenOut: TOKEN, fee: 10_000, recipient: account.address,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 900), amountIn: spend, amountOutMinimum: 0n }],
      }),
    }));
  await sleep(3000);

  const bought = (await retry("balance", () =>
    pub.readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }))) as bigint;
  console.log("bought", formatUnits(bought, 18), "NFT");

  await sleep(3000);
  await retry("approve token", async () =>
    pub.waitForTransactionReceipt({
      hash: await wallet.writeContract({ address: TOKEN, abi: erc20Abi, functionName: "approve", args: [ROUTER, bought] }),
    }));
  await sleep(3000);
  await retry("sell", async () =>
    pub.waitForTransactionReceipt({
      hash: await wallet.writeContract({
        address: ROUTER, abi: swapRouterAbi, functionName: "exactInputSingle",
        args: [{ tokenIn: TOKEN, tokenOut: USDC, fee: 10_000, recipient: account.address,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 900), amountIn: bought, amountOutMinimum: 0n }],
      }),
    }));
  console.log("sold it back — fees accrued on both sides\n");

  await sleep(3000);
  const treasury = (await read("treasury")) as `0x${string}`;
  await sleep(2000);
  const tBefore = (await retry("treasury bal", () =>
    pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [treasury] }))) as bigint;

  await sleep(2000);
  await retry("collectFees", async () =>
    pub.waitForTransactionReceipt({
      hash: await wallet.writeContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: "collectFees", args: [TOKEN] }),
    }));
  await sleep(3000);

  const escrowUsdc = (await read("escrowUsdc", [TOKEN])) as bigint;
  await sleep(2000);
  const escrowToken = (await read("escrowToken", [TOKEN])) as bigint;
  await sleep(2000);
  const tAfter = (await retry("treasury bal", () =>
    pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [treasury] }))) as bigint;
  await sleep(2000);
  const creatorTok = (await retry("creator tok", () =>
    pub.readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }))) as bigint;

  console.log("after collectFees:");
  console.log("  escrow USDC        ", usd(escrowUsdc), "  <- held for @tsukipad_, nobody can touch it");
  console.log("  escrow token       ", formatUnits(escrowToken, 18), " (0 = the token side was converted)");
  console.log("  treasury received  ", usd(tAfter - tBefore));
  console.log("  creator holds token", formatUnits(creatorTok, 18), " (0 = paid no tokens)");
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message.split("\n")[0] : e);
  process.exit(1);
});
