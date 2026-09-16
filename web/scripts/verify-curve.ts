/// Drives a bonding-curve launch through the frontend's own code path, against
/// the local anvil chain that `scripts/local-dev.sh` starts.
///
/// Mines the salt with the browser's `mineSalt`, launches with a developer buy,
/// buys the curve out from a second wallet so it graduates, then trades the
/// graduated pool through the router and collects its fees. A pass means the
/// website's curve launch button, trade panel and fee panels are wired to
/// contracts that behave as the page says they do.
///
///   pnpm exec tsx scripts/verify-curve.ts            # local anvil
///   RPC=https://rpc.testnet.arc.io KEY=0x… pnpm exec tsx scripts/verify-curve.ts

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, decodeEventLog, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { readFileSync } from "node:fs";

import { stateViewAbi, curveAbi, curveTokenAbi, erc20Abi, swapRouterAbi } from "../lib/abi";
import { poolKeyFor as poolKey, poolIdFor as poolId } from "../lib/v4";
import { mineSalt } from "../lib/launch-math";
import { encodeMetadata } from "../lib/metadata";

const RPC = process.env.RPC ?? "http://127.0.0.1:8545";
const USDC = "0x3600000000000000000000000000000000000000" as const;
const POOL_FEE = 10_000;

// anvil's first two default accounts
const KEY = (process.env.KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as `0x${string}`;
// The buyer. Anvil's second account by default; on a live network pass a
// funded key, or the creator's own key -- the walk still exercises everything.
const KEY2 = (process.env.BUYER_KEY ?? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d") as `0x${string}`;

const deployments = JSON.parse(readFileSync(new URL("../../contracts/deployments/5042002.json", import.meta.url), "utf8"));
const CURVE = (process.env.CURVE ?? deployments.curve) as Address;
// The walk's amounts, so the same script fits a throwaway curve that graduates
// at a few dollars on testnet and the real one that graduates at thousands.
const DEV_BUY = parseUnits(process.env.DEV_BUY_USDC ?? "250", 6);
const SMALL_BUY = parseUnits(process.env.SMALL_BUY_USDC ?? "1000", 6);
const BUYOUT = parseUnits(process.env.BUYOUT_USDC ?? "50000", 6);
const POOL_BUY = parseUnits(process.env.POOL_BUY_USDC ?? "2000", 6);
const POOL_TRADES = parseUnits(process.env.POOL_TRADES_USDC ?? "5000", 6);
// Tokens are CREATE2-deployed by the TokenDeployer, so that is what a salt is
// mined against -- mining against the pad would predict an address no launch
// can land on.
const TOKEN_DEPLOYER = (process.env.TOKEN_DEPLOYER ?? deployments.tokenDeployer) as Address;
const STATE_VIEW = (process.env.STATE_VIEW ?? deployments.stateView) as Address;
const MANAGER = (process.env.POOL_MANAGER ?? deployments.poolManager) as Address;
const ROUTER = (process.env.ROUTER ?? deployments.swapRouter) as Address;

const chain = { ...arcTestnet, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });

let failed = 0;
// On Arc the gas token is USDC, so every transaction a wallet sends moves the
// balance under test. Tallied and added back where a sender's delta is compared.
let gasSpent6 = 0n;
let gasIsUsdc = false;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}
const usd = (v: bigint) => `$${Number(formatUnits(v, 6)).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

async function main() {
  const creator = privateKeyToAccount(KEY);
  const buyer = privateKeyToAccount(KEY2);
  const creatorWallet = createWalletClient({ account: creator, chain, transport: http(RPC) });
  const buyerWallet = createWalletClient({ account: buyer, chain, transport: http(RPC) });
  const send = async (w: typeof creatorWallet, req: Parameters<typeof w.writeContract>[0]) => {
    const rc = await pub.waitForTransactionReceipt({ hash: await w.writeContract(req) });
    if (gasIsUsdc) gasSpent6 += (rc.gasUsed * rc.effectiveGasPrice) / 10n ** 12n;
    return rc;
  };

  console.log("curve  ", CURVE);
  console.log("creator", creator.address);
  console.log("buyer  ", buyer.address, "\n");

  // Fund the buyer. A bare anvil runs a mintable mock at the USDC address; a
  // fork of Arc has the real thing, which mints for nobody -- there the buyer is
  // funded out of band (anvil_setBalance: native balance *is* the USDC balance).
  const buyerFunded = (await pub.readContract({
    address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [buyer.address],
  })) as bigint;
  if (RPC.includes("127.0.0.1") && buyerFunded < parseUnits("50000", 6)) {
    await send(creatorWallet, { address: USDC, abi: [{ type: "function", name: "mint", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" }], functionName: "mint", args: [buyer.address, parseUnits("100000", 6)] });
  }

  // ---------- 1. LAUNCH, exactly as the create page does ----------
  gasIsUsdc = (await pub.getBalance({ address: buyer.address })) / 10n ** 12n === (await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [buyer.address] }));
  console.log(`gas paid in USDC: ${gasIsUsdc}\n`);
  console.log("1. LAUNCH");
  const name = "Curve Path";
  const symbol = "CURVE";
  const metadataURI = encodeMetadata({ description: "Launched on the bonding curve.", twitter: "@tsukipad_" });
  const initCodeHash = await pub.readContract({
    address: CURVE, abi: curveAbi, functionName: "tokenInitCodeHash",
    args: [creator.address, name, symbol, metadataURI, false],
  });
  const { salt, token: predicted, attempts } = mineSalt(TOKEN_DEPLOYER, creator.address, initCodeHash);
  console.log(`  mined ${predicted} in ${attempts} attempts`);

  const devBuy = DEV_BUY;
  await send(creatorWallet, { address: USDC, abi: erc20Abi, functionName: "approve", args: [CURVE, devBuy] });
  const launchReceipt = await send(creatorWallet, {
    address: CURVE, abi: curveAbi, functionName: "launch",
    args: [{ name, symbol, metadataURI, salt, devBuyUsdc: devBuy, minTokensOut: 0n, feeRecipient: "0x0000000000000000000000000000000000000000", creatorTaxBps: 100, rewardHolders: false, snipeExempt: [] }],
  });
  let token: Address | undefined;
  for (const log of launchReceipt.logs) {
    try {
      const p = decodeEventLog({ abi: curveAbi, data: log.data, topics: log.topics });
      if (p.eventName === "Launched") token = (p.args as { token: Address }).token;
    } catch {}
  }
  check("Launched event carries the token", !!token);
  if (!token) throw new Error("no token");
  check("browser's CREATE2 prediction matches the deployed address", token.toLowerCase() === predicted.toLowerCase());
  check("token sorts below USDC (token0)", BigInt(token) < BigInt(USDC));
  check("curve knows the token", await pub.readContract({ address: CURVE, abi: curveAbi, functionName: "isCurve", args: [token] }));

  const c0 = await pub.readContract({ address: CURVE, abi: curveAbi, functionName: "curveOf", args: [token] });
  check("dev buy raised USDC net of 2% fee", c0.usdcRaised === devBuy - (devBuy * 200n) / 10_000n, usd(c0.usdcRaised));
  const creatorBal = await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [creator.address] });
  check("creator holds the dev buy, untaxed", creatorBal > 0n, `${formatUnits(creatorBal, 18).split(".")[0]} tokens`);
  check("transfers locked before graduation", await pub.simulateContract({ address: token, abi: erc20Abi, functionName: "transfer", args: [buyer.address, 1n], account: creator.address }).then(() => false, () => true));

  // ---------- 2. TRADE ON THE CURVE ----------
  console.log("\n2. CURVE TRADES");
  const tax = await pub.readContract({ address: CURVE, abi: curveAbi, functionName: "snipeTaxBps", args: [token, buyer.address] });
  console.log(`  snipe tax for the buyer right now: ${Number(tax) / 100}%`);
  // On anvil the block after launch is seconds later; wait out the window either way.
  await new Promise((r) => setTimeout(r, 5_500));
  if (RPC.includes("127.0.0.1")) await pub.request({ method: "evm_mine" as never, params: [] as never });

  await send(buyerWallet, { address: USDC, abi: erc20Abi, functionName: "approve", args: [CURVE, 2n ** 255n] });
  const [qOut, qUsed, qFee] = await pub.readContract({ address: CURVE, abi: curveAbi, functionName: "quoteBuy", args: [token, SMALL_BUY, buyer.address] });
  check("quote past the snipe window charges only the 2% fee", qFee === (SMALL_BUY * 200n) / 10_000n, usd(qFee));
  const beforeBuy = await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [buyer.address] });
  await send(buyerWallet, { address: CURVE, abi: curveAbi, functionName: "buy", args: [token, SMALL_BUY, qOut, buyer.address] });
  const afterBuy = await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [buyer.address] });
  check("buy delivers exactly the quoted tokens", afterBuy - beforeBuy === qOut && qUsed === SMALL_BUY);

  const sellAmt = qOut / 4n;
  const [qSell] = await pub.readContract({ address: CURVE, abi: curveAbi, functionName: "quoteSell", args: [token, sellAmt] });
  await send(buyerWallet, { address: token, abi: erc20Abi, functionName: "approve", args: [CURVE, sellAmt] });
  const usdcBefore = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [buyer.address] });
  const gasBeforeSell = gasSpent6;
  await send(buyerWallet, { address: CURVE, abi: curveAbi, functionName: "sell", args: [token, sellAmt, qSell, buyer.address] });
  const usdcAfter = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [buyer.address] });
  const sellDelta = usdcAfter - usdcBefore + (gasSpent6 - gasBeforeSell);
  // Within a micro-dollar: the 6-decimal view of an 18-decimal balance truncates.
  check("sell pays exactly the quoted USDC", sellDelta >= qSell - 2n && sellDelta <= qSell + 2n, usd(qSell));

  const owed = await pub.readContract({ address: CURVE, abi: curveAbi, functionName: "creatorFeesOwed", args: [token] });
  check("creator fees accrue on the curve", owed > 0n, usd(owed));

  // ---------- 3. GRADUATE ----------
  console.log("\n3. GRADUATION");
  const usdcPre = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [buyer.address] });
  await send(buyerWallet, { address: CURVE, abi: curveAbi, functionName: "buy", args: [token, BUYOUT, 0n, buyer.address] });
  const usdcPost = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [buyer.address] });
  const c1 = await pub.readContract({ address: CURVE, abi: curveAbi, functionName: "curveOf", args: [token] });
  check("curve graduated", c1.graduated);
  const gradUsdc = (await pub.readContract({ address: CURVE, abi: curveAbi, functionName: "graduationUsdc" })) as bigint;
  check(
    `final buy charged only what was left, not the ${usd(BUYOUT)} offered`,
    usdcPre - usdcPost < (gradUsdc * 13n) / 10n && usdcPre - usdcPost < BUYOUT,
    usd(usdcPre - usdcPost),
  );
  check("token graduated (transfers open)", await pub.readContract({ address: token, abi: curveTokenAbi, functionName: "graduated" }));
  check("pool recorded", c1.pool !== "0x" + "0".repeat(64), c1.pool);
  const [sqrtP] = (await pub.readContract({
    address: STATE_VIEW,
    abi: stateViewAbi,
    functionName: "getSlot0",
    args: [poolId(token)],
  })) as readonly [bigint, number, number, number];
  const price = (Number(sqrtP) / 2 ** 96) ** 2 * 1e12;
  const mcap = price * 1e9;
  // Where the curve says it graduates: raise / pool share, whatever this
  // curve's parameters are -- the production $52K or a throwaway's few dollars.
  const lpSupplyWei = (await pub.readContract({ address: CURVE, abi: curveAbi, functionName: "lpSupply" })) as bigint;
  const totalWei = (await pub.readContract({ address: CURVE, abi: curveAbi, functionName: "TOTAL_SUPPLY" })) as bigint;
  const expectedMcap = (Number(gradUsdc) / 1e6) * (Number(totalWei) / Number(lpSupplyWei));
  check(
    `pool opened at the graduation market cap (~$${Math.round(expectedMcap).toLocaleString()})`,
    mcap > expectedMcap * 0.98 && mcap < expectedMcap * 1.02,
    `$${Math.round(mcap).toLocaleString()}`,
  );
  // Every v4 pool's balances sit in the manager, so that is where the raise is.
  const poolUsdc = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [MANAGER] });
  // Read the target off the contract rather than hardcoding it: the raise and
  // the opening market cap move together whenever the pool share changes.
  const graduationUsdc = (await pub.readContract({
    address: CURVE, abi: curveAbi, functionName: "graduationUsdc",
  })) as bigint;
  check("the whole raise is in the pool", poolUsdc >= graduationUsdc - 10n, usd(poolUsdc));
  check("curve holds no tokens after graduation", (await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [CURVE] })) === 0n);
  check("curve refuses further buys", await pub.simulateContract({ address: CURVE, abi: curveAbi, functionName: "buy", args: [token, 1_000_000n, 0n, buyer.address], account: buyer.address }).then(() => false, () => true));

  // ---------- 4. POOL TRADING + FEES ----------
  console.log("\n4. POOL");
  await send(buyerWallet, { address: USDC, abi: erc20Abi, functionName: "approve", args: [ROUTER, POOL_TRADES] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const bought = await pub.simulateContract({
    address: ROUTER, abi: swapRouterAbi, functionName: "exactInputSingle",
    args: [{ key: poolKey(token), zeroForOne: false, amountIn: POOL_BUY, amountOutMinimum: 0n, recipient: buyer.address, deadline }],
    account: buyer.address,
  }).then((r) => r.result);
  await send(buyerWallet, { address: ROUTER, abi: swapRouterAbi, functionName: "exactInputSingle", args: [{ key: poolKey(token), zeroForOne: false, amountIn: POOL_BUY, amountOutMinimum: 0n, recipient: buyer.address, deadline }] });
  check("buy through the router works after graduation", bought > 0n);
  await send(buyerWallet, { address: token, abi: erc20Abi, functionName: "approve", args: [ROUTER, bought] });
  await send(buyerWallet, { address: ROUTER, abi: swapRouterAbi, functionName: "exactInputSingle", args: [{ key: poolKey(token), zeroForOne: true, amountIn: bought, amountOutMinimum: 0n, recipient: buyer.address, deadline }] });
  check("sell through the router works after graduation", true);
  await send(buyerWallet, { address: token, abi: erc20Abi, functionName: "transfer", args: [creator.address, 1n] });
  check("wallet-to-wallet transfer works after graduation", true);

  const liqBefore = (await pub.readContract({
    address: STATE_VIEW,
    abi: stateViewAbi,
    functionName: "getLiquidity",
    args: [poolId(token)],
  })) as bigint;
  const owedBefore = await pub.readContract({ address: CURVE, abi: curveAbi, functionName: "creatorFeesOwed", args: [token] });
  await send(buyerWallet, { address: CURVE, abi: curveAbi, functionName: "collectFees", args: [token] });
  const owedAfter = await pub.readContract({ address: CURVE, abi: curveAbi, functionName: "creatorFeesOwed", args: [token] });
  const liqAfter = (await pub.readContract({
    address: STATE_VIEW,
    abi: stateViewAbi,
    functionName: "getLiquidity",
    args: [poolId(token)],
  })) as bigint;
  check("pool fees collected into the creator balance", owedAfter > owedBefore, usd(owedAfter - owedBefore));
  check("pool liquidity untouched by collection", liqAfter === liqBefore);

  const cUsdcBefore = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [creator.address] });
  const gasBeforePayout = gasSpent6;
  await send(buyerWallet, { address: CURVE, abi: curveAbi, functionName: "claimCreatorFees", args: [token] });
  const cUsdcAfter = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [creator.address] });
  check("anyone can trigger the payout; it reaches the creator", cUsdcAfter - cUsdcBefore + (gasSpent6 - gasBeforePayout) >= owedAfter - 2n, usd(owedAfter));

  console.log(`\ntoken ${token}`);
  console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
