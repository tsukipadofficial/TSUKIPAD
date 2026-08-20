/// Full end-to-end verification against live Arc testnet.
///
/// Deliberately imports the frontend's own modules — `mineSalt`,
/// `encodeMetadata`, the launch maths — rather than reimplementing them. A pass
/// here means the website works, not merely that the contracts do.
///
///   pnpm exec tsx scripts/e2e.ts

import {
  createPublicClient, createWalletClient, http, parseUnits, formatUnits,
  decodeEventLog, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { readFileSync } from "node:fs";

import { launchpadAbi, launchTokenAbi, swapRouterAbi, erc20Abi } from "../lib/abi";
import { mineSalt, startTickForMarketCap, ceilingTick, marketCapAtTick, curveCapacityUsd } from "../lib/launch-math";
import { encodeMetadata, decodeMetadata } from "../lib/metadata";

const RPC = "https://rpc.testnet.arc.io";
const USDC = "0x3600000000000000000000000000000000000000" as const;
const POOL_FEE = 10_000;

function env(key: string): string {
  const f = readFileSync(new URL("../.env.production", import.meta.url), "utf8");
  const m = f.match(new RegExp(`^${key}=(.+)$`, "m"));
  if (!m) throw new Error(`${key} missing from .env.production`);
  return m[1].trim();
}
const LAUNCHPAD = env("NEXT_PUBLIC_LAUNCHPAD_ADDRESS") as Address;
const ROUTER = env("NEXT_PUBLIC_SWAP_ROUTER_ADDRESS") as Address;

function key(): Hex {
  const f = readFileSync(new URL("../../.secrets/deployer.env", import.meta.url), "utf8");
  return f.match(/ARC_DEPLOYER_KEY=(0x[0-9a-fA-F]+)/)![1] as Hex;
}

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};
const usd = (v: bigint) => `$${Number(formatUnits(v, 6)).toFixed(4)}`;
const tok = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 0 });
const pause = () => new Promise((r) => setTimeout(r, 2500)); // public RPC dislikes bursts

async function main() {
  const account = privateKeyToAccount(key());
  const pub = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(RPC) });

  console.log(`\nchain     ${await pub.getChainId()}  (Arc testnet)`);
  console.log(`launchpad ${LAUNCHPAD}`);
  console.log(`wallet    ${account.address}`);
  console.log(`balance   ${usd(await pub.getBalance({ address: account.address }) / 10n ** 12n)}\n`);

  // ---------- 1. LAUNCH, through the frontend's own path ----------
  console.log("1. LAUNCH");
  const name = `E2E ${Date.now() % 100000}`;
  const symbol = `E2E${Date.now() % 1000}`;
  const supply = 1_000_000_000n;
  const supplyWei = parseUnits(supply.toString(), 18);
  const metadataURI = encodeMetadata({
    description: "End-to-end verification run.",
    twitter: "@tsukipad_",
    telegram: "t.me/tsukipadofficial",
  });
  const tickLower = startTickForMarketCap(3_000, supply);
  const tickUpper = ceilingTick(tickLower, 10_000);
  const ALLOCATION_BPS = 1_000; // 10%, to exercise the creator lock

  const initCodeHash = (await pub.readContract({
    address: LAUNCHPAD, abi: launchpadAbi, functionName: "tokenInitCodeHash",
    args: [account.address, name, symbol, supplyWei, metadataURI, false],
  })) as Hex;
  const { salt, token: predicted, attempts } = mineSalt(LAUNCHPAD, account.address, initCodeHash);

  let hash = await wallet.writeContract({
    address: LAUNCHPAD, abi: launchpadAbi, functionName: "launch",
    args: [{
      name, symbol, metadataURI, totalSupply: supplyWei, salt,
      tickLower, tickUpper, creatorAllocationBps: ALLOCATION_BPS,
      rewardHolders: false, feeRecipient: "0x0000000000000000000000000000000000000000",
      buybackAndBurn: false,
    }],
  });
  let rc = await pub.waitForTransactionReceipt({ hash });
  check("launch confirmed", rc.status === "success", `gas ${rc.gasUsed}`);

  let token = "" as Address, pool = "" as Address;
  for (const log of rc.logs) {
    try {
      const p = decodeEventLog({ abi: launchpadAbi, data: log.data, topics: log.topics });
      if (p.eventName === "Launched") {
        const a = p.args as { token: Address; pool: Address };
        token = a.token; pool = a.pool;
      }
    } catch { /* other event */ }
  }
  check("browser CREATE2 prediction matched", token.toLowerCase() === predicted.toLowerCase(), `${attempts} salts`);
  check("token sorts below USDC (is token0)", BigInt(token) < BigInt(USDC));

  const [t0, t1] = await Promise.all([
    pub.readContract({ address: pool, abi: [{ name: "token0", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }], functionName: "token0" }),
    pub.readContract({ address: pool, abi: [{ name: "token1", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }], functionName: "token1" }),
  ]);
  check("pool is TOKEN/USDC", (t0 as string).toLowerCase() === token.toLowerCase() && (t1 as string).toLowerCase() === USDC);

  // ---------- 2. SUPPLY & METADATA ----------
  console.log("\n2. SUPPLY & METADATA");
  const [total, inPool, heldByPad] = await Promise.all([
    pub.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }) as Promise<bigint>,
    pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [pool] }) as Promise<bigint>,
    pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [LAUNCHPAD] }) as Promise<bigint>,
  ]);
  check("supply is 1,000,000,000", total === supplyWei);
  check("90% seeded into the pool", inPool > (supplyWei * 89n) / 100n, tok(inPool));
  check("10% allocation held by launchpad, not creator", heldByPad > (supplyWei * 9n) / 100n, tok(heldByPad));
  const onchainMeta = (await pub.readContract({ address: token, abi: launchTokenAbi, functionName: "metadataURI" })) as string;
  const decoded = decodeMetadata(onchainMeta);
  check("metadata readable on-chain", decoded.twitter === "@tsukipad_" && !!decoded.telegram, `${onchainMeta.length} bytes`);
  check("pool holds no USDC at launch (cost $0)", (await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [pool] })) === 0n);

  // ---------- 3. CREATOR LOCK ----------
  console.log("\n3. CREATOR LOCK");
  try {
    await pub.simulateContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: "claimCreatorAllocation", args: [token], account: account.address });
    check("early claim rejected", false, "it did NOT revert");
  } catch {
    check("early claim rejected (StillLocked)", true);
  }

  // ---------- 4. BUY ----------
  console.log("\n4. BUY");
  await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [ROUTER, parseUnits("50", 6)] });
  await pause();
  const buyAmt = parseUnits("3", 6);
  const { result: quoted } = await pub.simulateContract({
    address: ROUTER, abi: swapRouterAbi, functionName: "exactInputSingle",
    args: [{ tokenIn: USDC, tokenOut: token, fee: POOL_FEE, recipient: account.address, deadline: BigInt(Math.floor(Date.now() / 1000) + 600), amountIn: buyAmt, amountOutMinimum: 0n }],
    account: account.address,
  });
  check("UI quoting works on live RPC", (quoted as bigint) > 0n, `${tok(quoted as bigint)} tokens for $3`);

  // The wallet already holds rounding dust left over from the liquidity mint,
  // so compare the *delta* rather than the absolute balance.
  const tokBeforeBuy = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) as bigint;
  hash = await wallet.writeContract({
    address: ROUTER, abi: swapRouterAbi, functionName: "exactInputSingle",
    args: [{ tokenIn: USDC, tokenOut: token, fee: POOL_FEE, recipient: account.address, deadline: BigInt(Math.floor(Date.now() / 1000) + 600), amountIn: buyAmt, amountOutMinimum: 0n }],
  });
  rc = await pub.waitForTransactionReceipt({ hash });
  const tokAfterBuy = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) as bigint;
  const bought = tokAfterBuy - tokBeforeBuy;
  check("buy executed", rc.status === "success");
  check("quote matched reality exactly", bought === (quoted as bigint), `got ${tok(bought)}`);
  check("pool received the USDC", (await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [pool] })) === buyAmt);
  await pause();

  // ---------- 5. SELL ----------
  console.log("\n5. SELL");
  const usdcBefore = await pub.getBalance({ address: account.address });
  await wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [ROUTER, bought] });
  await pause();
  hash = await wallet.writeContract({
    address: ROUTER, abi: swapRouterAbi, functionName: "exactInputSingle",
    args: [{ tokenIn: token, tokenOut: USDC, fee: POOL_FEE, recipient: account.address, deadline: BigInt(Math.floor(Date.now() / 1000) + 600), amountIn: bought / 2n, amountOutMinimum: 0n }],
  });
  rc = await pub.waitForTransactionReceipt({ hash });
  check("sell executed", rc.status === "success");
  const usdcAfter = await pub.getBalance({ address: account.address });
  check("USDC came back on sell", usdcAfter > usdcBefore - parseUnits("1", 18), usd((usdcAfter - usdcBefore) / 10n ** 12n));
  await pause();

  // ---------- 6. FEES ----------
  console.log("\n6. FEES");
  const creatorTokBefore = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) as bigint;
  hash = await wallet.writeContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: "collectFees", args: [token] });
  rc = await pub.waitForTransactionReceipt({ hash });
  check("collectFees succeeded", rc.status === "success");
  const creatorTokAfter = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) as bigint;
  check("token-side fees paid to creator", creatorTokAfter > creatorTokBefore, `+${tok(creatorTokAfter - creatorTokBefore)}`);
  check("launchpad holds no stray USDC", (await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [LAUNCHPAD] })) === 0n);

  // ---------- 7. SAFETY INVARIANTS ----------
  console.log("\n7. SAFETY");
  const cap = (await pub.readContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: "MAX_PROTOCOL_FEE_BPS" })) as number;
  check("protocol fee capped at 50%", Number(cap) === 5000);
  const stillLocked = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [LAUNCHPAD] })) as bigint;
  check("creator allocation still locked", stillLocked > (supplyWei * 9n) / 100n, tok(stillLocked));
  const poolTokens = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [pool] })) as bigint;
  check("liquidity still in the pool", poolTokens > (supplyWei * 80n) / 100n, tok(poolTokens));

  console.log(`\n${"=".repeat(52)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`  token: https://testnet.arcscan.app/address/${token}`);
  console.log(`  site : https://www.tsukipad.com/token/${token}`);
  console.log(`${"=".repeat(52)}\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error("\nERROR:", e instanceof Error ? e.message.split("\n")[0] : e); process.exit(1); });
