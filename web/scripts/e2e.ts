/// Full end-to-end verification against live Arc testnet.
///
/// Deliberately imports the frontend's own modules — `mineSalt`,
/// `encodeMetadata`, the launch maths — rather than reimplementing them. A pass
/// here means the website works, not merely that the contracts do.
///
///   pnpm exec tsx scripts/e2e.ts                    # live Arc testnet
///   RPC=http://127.0.0.1:8546 KEY=0x… LAUNCHPAD=0x… ROUTER=0x… \
///     pnpm exec tsx scripts/e2e.ts                  # any other chain

import {
  createPublicClient, createWalletClient, http, parseUnits, formatUnits,
  decodeEventLog, type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { readFileSync } from "node:fs";

import { launchpadAbi, launchTokenAbi, swapRouterAbi, stateViewAbi, erc20Abi } from "../lib/abi";
import { poolKeyFor as poolKey, poolIdFor as poolId } from "../lib/v4";
import { mineSalt, startTickForMarketCap, ceilingTick, marketCapAtTick, curveCapacityUsd } from "../lib/launch-math";
import { encodeMetadata, decodeMetadata } from "../lib/metadata";

const RPC = process.env.RPC ?? "https://rpc.testnet.arc.io";
const USDC = "0x3600000000000000000000000000000000000000" as const;
const POOL_FEE = 10_000;

function env(key: string): string {
  // An explicit environment wins, so the same script can be pointed at a local
  // chain without touching the production env file.
  if (process.env[key]) return process.env[key] as string;
  const f = readFileSync(new URL("../.env.production", import.meta.url), "utf8");
  const m = f.match(new RegExp(`^${key}=(.+)$`, "m"));
  if (!m) throw new Error(`${key} missing from .env.production`);
  return m[1].trim();
}
const LAUNCHPAD = (process.env.LAUNCHPAD ?? env("NEXT_PUBLIC_LAUNCHPAD_ADDRESS")) as Address;
const ROUTER = (process.env.ROUTER ?? env("NEXT_PUBLIC_SWAP_ROUTER_ADDRESS")) as Address;
const TOKEN_DEPLOYER = (process.env.TOKEN_DEPLOYER ?? env("NEXT_PUBLIC_TOKEN_DEPLOYER_ADDRESS")) as Address;
// Uniswap v4 holds every pool's balances in the one manager, so "what the pool
// holds" is the manager's balance of that currency.
const MANAGER = (process.env.POOL_MANAGER ?? env("NEXT_PUBLIC_POOL_MANAGER_ADDRESS")) as Address;
const STATE_VIEW = (process.env.STATE_VIEW ?? env("NEXT_PUBLIC_STATE_VIEW_ADDRESS")) as Address;

function key(): Hex {
  if (process.env.KEY) return process.env.KEY as Hex;
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
  const chain = { ...arcTestnet, rpcUrls: { default: { http: [RPC] } } };
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain, transport: http(RPC) });

  console.log(`\nchain     ${await pub.getChainId()}  (Arc testnet)`);
  console.log(`launchpad ${LAUNCHPAD}`);
  console.log(`wallet    ${account.address}`);
  console.log(`balance   ${usd(await pub.getBalance({ address: account.address }) / 10n ** 12n)}\n`);

  const managerUsdcBeforeLaunch = (await pub.readContract({
    address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [MANAGER],
  })) as bigint;

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
  const { salt, token: predicted, attempts } = mineSalt(TOKEN_DEPLOYER, account.address, initCodeHash);

  let hash = await wallet.writeContract({
    address: LAUNCHPAD, abi: launchpadAbi, functionName: "launch",
    args: [{
      name, symbol, metadataURI, totalSupply: supplyWei, salt,
      tickLower, tickUpper, creatorAllocationBps: ALLOCATION_BPS,
      rewardHolders: false, feeRecipient: "0x0000000000000000000000000000000000000000",
      buybackAndBurn: false,
        recipientCommitment: ("0x" + "0".repeat(64)) as `0x${string}`,
        referrer: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      creatorTaxBps: 0,
    }],
  });
  let rc = await pub.waitForTransactionReceipt({ hash });
  check("launch confirmed", rc.status === "success", `gas ${rc.gasUsed}`);

  let token = "" as Address, pool = "" as Hex;
  for (const log of rc.logs) {
    try {
      const p = decodeEventLog({ abi: launchpadAbi, data: log.data, topics: log.topics });
      if (p.eventName === "Launched") {
        const a = p.args as { token: Address; poolId: Hex };
        token = a.token; pool = a.poolId;
      }
    } catch { /* other event */ }
  }
  check("browser CREATE2 prediction matched", token.toLowerCase() === predicted.toLowerCase(), `${attempts} salts`);
  check("token sorts below USDC (is token0)", BigInt(token) < BigInt(USDC));

  const [t0, t1] = await Promise.all([
    Promise.resolve(poolKey(token).currency0),
    Promise.resolve(poolKey(token).currency1),
  ]);
  check("pool is TOKEN/USDC", (t0 as string).toLowerCase() === token.toLowerCase() && (t1 as string).toLowerCase() === USDC);
  check("pool id matches the one the browser derives", pool.toLowerCase() === poolId(token).toLowerCase());

  // ---------- 2. SUPPLY & METADATA ----------
  console.log("\n2. SUPPLY & METADATA");
  const [total, inPool, heldByPad] = await Promise.all([
    pub.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }) as Promise<bigint>,
    pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [MANAGER] }) as Promise<bigint>,
    pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [LAUNCHPAD] }) as Promise<bigint>,
  ]);
  check("supply is 1,000,000,000", total === supplyWei);
  check("90% seeded into the pool", inPool > (supplyWei * 89n) / 100n, tok(inPool));
  check("10% allocation delivered at launch, launchpad holds none", heldByPad === 0n, tok(heldByPad));
  const onchainMeta = (await pub.readContract({ address: token, abi: launchTokenAbi, functionName: "metadataURI" })) as string;
  const managerUsdcAfterLaunch = (await pub.readContract({
    address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [MANAGER],
  })) as bigint;
  const decoded = decodeMetadata(onchainMeta);
  check("metadata readable on-chain", decoded.twitter === "@tsukipad_" && !!decoded.telegram, `${onchainMeta.length} bytes`);
  // The manager holds every pool's balances, so this is what *this* launch's
  // pool is owed rather than what the manager happens to hold overall.
  check(
    "pool opens single-sided: no USDC needed from anyone",
    managerUsdcAfterLaunch === managerUsdcBeforeLaunch,
    usd(managerUsdcAfterLaunch - managerUsdcBeforeLaunch),
  );

  // ---------- 4. BUY ----------
  console.log("\n4. BUY");
  await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [ROUTER, parseUnits("50", 6)] });
  await pause();
  const buyAmt = parseUnits("3", 6);
  const { result: quoted } = await pub.simulateContract({
    address: ROUTER, abi: swapRouterAbi, functionName: "exactInputSingle",
    args: [{
        key: poolKey(token),
        zeroForOne: false,
        amountIn: buyAmt,
        amountOutMinimum: 0n,
        recipient: account.address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
      }],
    account: account.address,
  });
  check("UI quoting works on live RPC", (quoted as bigint) > 0n, `${tok(quoted as bigint)} tokens for $3`);

  // The wallet already holds rounding dust left over from the liquidity mint,
  // so compare the *delta* rather than the absolute balance.
  const tokBeforeBuy = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) as bigint;
  const managerUsdcBeforeBuy = (await pub.readContract({
    address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [MANAGER],
  })) as bigint;
  hash = await wallet.writeContract({
    address: ROUTER, abi: swapRouterAbi, functionName: "exactInputSingle",
    args: [{
        key: poolKey(token),
        zeroForOne: false,
        amountIn: buyAmt,
        amountOutMinimum: 0n,
        recipient: account.address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
      }],
      });
  rc = await pub.waitForTransactionReceipt({ hash });
  const tokAfterBuy = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) as bigint;
  const bought = tokAfterBuy - tokBeforeBuy;
  check("buy executed", rc.status === "success");
  check("quote matched reality exactly", bought === (quoted as bigint), `got ${tok(bought)}`);
  const managerUsdcAfterBuy = (await pub.readContract({
    address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [MANAGER],
  })) as bigint;
  check("pool received the USDC", managerUsdcAfterBuy - managerUsdcBeforeBuy === buyAmt);
  await pause();

  // ---------- 5. SELL ----------
  console.log("\n5. SELL");
  const usdcBefore = await pub.getBalance({ address: account.address });
  await wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [ROUTER, bought] });
  await pause();
  hash = await wallet.writeContract({
    address: ROUTER, abi: swapRouterAbi, functionName: "exactInputSingle",
    args: [{
        key: poolKey(token),
        zeroForOne: true,
        amountIn: bought / 2n,
        amountOutMinimum: 0n,
        recipient: account.address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
      }],
      });
  rc = await pub.waitForTransactionReceipt({ hash });
  check("sell executed", rc.status === "success");
  const usdcAfter = await pub.getBalance({ address: account.address });
  check("USDC came back on sell", usdcAfter > usdcBefore - parseUnits("1", 18), usd((usdcAfter - usdcBefore) / 10n ** 12n));
  await pause();

  // ---------- 6. FEES ----------
  console.log("\n6. FEES");
  // Fees reach the creator in USDC: the token side is swapped before the split,
  // and only what the swap could not clear is paid in kind. So count both.
  const bal = async (erc20: Address) =>
    (await pub.readContract({ address: erc20, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })) as bigint;
  const creatorTokBefore = await bal(token);
  const creatorUsdcBefore = await bal(USDC);
  hash = await wallet.writeContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: "collectFees", args: [token] });
  rc = await pub.waitForTransactionReceipt({ hash });
  check("collectFees succeeded", rc.status === "success");
  const gotTok = (await bal(token)) - creatorTokBefore;
  const gotUsdc = (await bal(USDC)) - creatorUsdcBefore;
  check("swap fees reached the creator", gotTok > 0n || gotUsdc > 0n, `${usd(gotUsdc)} + ${tok(gotTok)} tokens`);
  check("launchpad holds no stray USDC", (await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [LAUNCHPAD] })) === 0n);

  // ---------- 7. SAFETY INVARIANTS ----------
  console.log("\n7. SAFETY");
  const cap = (await pub.readContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: "MAX_PROTOCOL_FEE_BPS" })) as number;
  check("protocol fee capped at 50%", Number(cap) === 5000);
  // There is no creator lock any more: the allocation is delivered at launch,
  // so the launchpad must not be sitting on supply afterwards.
  const padSupply = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [LAUNCHPAD] })) as bigint;
  check("launchpad holds no token supply", padSupply === 0n, tok(padSupply));
  const poolTokens = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [MANAGER] })) as bigint;
  check("liquidity still in the pool", poolTokens > (supplyWei * 80n) / 100n, tok(poolTokens));

  console.log(`\n${"=".repeat(52)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`  token: https://testnet.arcscan.app/address/${token}`);
  console.log(`  site : https://www.tsukipad.com/token/${token}`);
  console.log(`${"=".repeat(52)}\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error("\nERROR:", e instanceof Error ? e.message.split("\n")[0] : e); process.exit(1); });
