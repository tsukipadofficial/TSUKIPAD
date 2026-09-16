/// Every fee mode the create page offers, exercised for real.
///
/// One direct launch per mode -- keep, holders, buy-back-and-burn, send to a
/// project -- each with a 3% creator tax, traded, collected, and checked for
/// two things the site promises: the fees land where that mode says they do,
/// and every payout is USDC. Nobody is ever handed a bag of the token.
///
/// Also checks what the pad promises the platform: the treasury's share
/// includes its cut of the creator tax, in USDC.
///
///   RPC=http://127.0.0.1:8546 KEY=0x… LAUNCHPAD=0x… ROUTER=0x… \
///   TOKEN_DEPLOYER=0x… POOL_MANAGER=0x… TRADE_USDC=1000 pnpm exec tsx scripts/verify-fee-modes.ts

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";

import { launchpadAbi, launchTokenAbi, swapRouterAbi, erc20Abi } from "../lib/abi";
import { mineSalt, startTickForMarketCap, ceilingTick } from "../lib/launch-math";
import { poolKeyFor } from "../lib/v4";
import { DEFAULT_CEILING_MULTIPLE, DEFAULT_START_MCAP_USD } from "../lib/config";

const RPC = process.env.RPC ?? "http://127.0.0.1:8546";
const USDC = "0x3600000000000000000000000000000000000000" as const;
const KEY = (process.env.KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;
const LAUNCHPAD = process.env.LAUNCHPAD as Address;
const ROUTER = process.env.ROUTER as Address;
const TOKEN_DEPLOYER = process.env.TOKEN_DEPLOYER as Address;
const TRADE = parseUnits(process.env.TRADE_USDC ?? "1000", 6);
const SUPPLY = 1_000_000_000n;

const chain = { ...arcTestnet, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const account = privateKeyToAccount(KEY);
const wallet = createWalletClient({ account, chain, transport: http(RPC) });

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};
const usd = (v: bigint) => `$${Number(formatUnits(v, 6)).toFixed(4)}`;
// "Nothing" for the sender's own USDC: the 6-decimal view of an 18-decimal
// native balance and the per-tx gas tally each truncate, so a genuinely zero
// payout can read as a micro-dollar or two either way.
const nothing = (v: bigint) => (v < 0n ? -v : v) <= 2n;
const bal = async (erc20: Address, who: Address) =>
  (await pub.readContract({ address: erc20, abi: erc20Abi, functionName: "balanceOf", args: [who] })) as bigint;

// On Arc the gas token *is* USDC, so every transaction this account sends also
// moves the USDC balance being measured. Gas is tallied here and added back
// wherever the sender's own delta is inspected. On anvil gas is a separate
// asset and the tally is left out.
let gasSpent6 = 0n;
let gasIsUsdc = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function send(args: any): Promise<void> {
  const hash = await wallet.writeContract(args);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`tx failed: ${args.functionName}`);
  if (gasIsUsdc) gasSpent6 += (rc.gasUsed * rc.effectiveGasPrice) / 10n ** 12n;
}

type Mode = "keep" | "holders" | "burn" | "project";

// A token's address is derived from its name and creator, so a second run
// with the same names would try to deploy onto addresses the first already
// took. Each run gets its own suffix.
const RUN = Date.now().toString(36).slice(-4);

async function launch(mode: Mode, project: Address): Promise<Address> {
  const name = `Mode ${mode} ${RUN}`;
  const symbol = mode.toUpperCase().slice(0, 6);
  const uri = "";
  const rewardHolders = mode === "holders";
  const supplyWei = parseUnits(SUPPLY.toString(), 18);
  const initCodeHash = (await pub.readContract({
    address: LAUNCHPAD, abi: launchpadAbi, functionName: "tokenInitCodeHash",
    args: [account.address, name, symbol, supplyWei, uri, rewardHolders],
  })) as Hex;
  const { salt, token } = mineSalt(TOKEN_DEPLOYER, account.address, initCodeHash);
  const tickLower = startTickForMarketCap(DEFAULT_START_MCAP_USD, SUPPLY);
  const tickUpper = ceilingTick(tickLower, DEFAULT_CEILING_MULTIPLE);

  await send({
    address: LAUNCHPAD, abi: launchpadAbi, functionName: "launch",
    args: [{
      name, symbol, metadataURI: uri, totalSupply: supplyWei, salt, tickLower, tickUpper,
      creatorAllocationBps: 0,
      rewardHolders,
      feeRecipient: mode === "project" ? project : ("0x0000000000000000000000000000000000000000" as Address),
      buybackAndBurn: mode === "burn",
      recipientCommitment: ("0x" + "0".repeat(64)) as Hex,
      referrer: "0x0000000000000000000000000000000000000000" as Address,
      creatorTaxBps: 300,
    }],
  });
  return token;
}

async function trade(token: Address): Promise<void> {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  await send({ address: USDC, abi: erc20Abi, functionName: "approve", args: [ROUTER, TRADE] });
  const before = await bal(token, account.address);
  await send({
    address: ROUTER, abi: swapRouterAbi, functionName: "exactInputSingle",
    args: [{ key: poolKeyFor(token), zeroForOne: false, amountIn: TRADE, amountOutMinimum: 0n, recipient: account.address, deadline }],
  });
  const bought = (await bal(token, account.address)) - before;
  await send({ address: token, abi: erc20Abi, functionName: "approve", args: [ROUTER, bought / 2n] });
  await send({
    address: ROUTER, abi: swapRouterAbi, functionName: "exactInputSingle",
    args: [{ key: poolKeyFor(token), zeroForOne: true, amountIn: bought / 2n, amountOutMinimum: 0n, recipient: account.address, deadline }],
  });
}

async function main() {
  const treasury = (await pub.readContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: "treasury" })) as Address;
  // Arc's USDC is a 6-decimal view over the 18-decimal native balance. When
  // the two agree, gas comes out of the balance under test.
  gasIsUsdc = (await pub.getBalance({ address: account.address })) / 10n ** 12n === (await bal(USDC, account.address));
  console.log(`gas paid in USDC: ${gasIsUsdc}`);
  const project = "0x000000000000000000000000000000000000beef" as Address;
  console.log(`launchpad ${LAUNCHPAD}\ntreasury  ${treasury}\ntrade     ${usd(TRADE)} buy, half sold back\n`);

  for (const mode of ["keep", "holders", "burn", "project"] as Mode[]) {
    console.log(`\n== ${mode.toUpperCase()}`);
    const token = await launch(mode, project);
    await trade(token);

    const creatorUsdc0 = await bal(USDC, account.address);
    const gas0 = gasSpent6;
    const creatorTok0 = await bal(token, account.address);
    const treasuryUsdc0 = await bal(USDC, treasury);
    const treasuryTok0 = await bal(token, treasury);
    const projectUsdc0 = await bal(USDC, project);
    const supply0 = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" })) as bigint;
    const rewards0 = (await pub.readContract({ address: token, abi: launchTokenAbi, functionName: "totalRewardsReceived" })) as bigint;

    await send({ address: LAUNCHPAD, abi: launchpadAbi, functionName: "collectFees", args: [token] });

    // What collection paid the creator, with the gas they spent to trigger it
    // put back -- gas is a cost of calling, not a fee outcome.
    const creatorUsdc = (await bal(USDC, account.address)) - creatorUsdc0 + (gasSpent6 - gas0);
    const creatorTok = (await bal(token, account.address)) - creatorTok0;
    const treasuryUsdc = (await bal(USDC, treasury)) - treasuryUsdc0;
    const treasuryTok = (await bal(token, treasury)) - treasuryTok0;
    const projectUsdc = (await bal(USDC, project)) - projectUsdc0;
    const supply = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" })) as bigint;
    const rewards = (await pub.readContract({ address: token, abi: launchTokenAbi, functionName: "totalRewardsReceived" })) as bigint;

    // The platform side, identical in every mode: paid, in USDC, never in the token.
    check("platform paid its share", treasuryUsdc > 0n, usd(treasuryUsdc));
    check("platform paid in USDC only", treasuryTok === 0n);
    check("collection leaves no token in the pad", (await bal(token, LAUNCHPAD)) === 0n);

    if (mode === "keep") {
      check("creator paid", creatorUsdc > 0n, usd(creatorUsdc));
      check("creator paid in USDC only", creatorTok === 0n);
      // 3% tax on top of the 1% fee, split 70/30: the creator's slice should
      // dwarf the platform's by roughly that ratio, not by 4:1 as it would if
      // the tax were the creator's alone.
      const ratio = Number(creatorUsdc) / Number(treasuryUsdc);
      check("creator : platform ≈ 70 : 30, tax included", ratio > 2.1 && ratio < 2.6, ratio.toFixed(2));
    }
    if (mode === "holders") {
      check("fees became holder rewards", rewards > rewards0, usd(rewards - rewards0));
      check("creator was not paid instead", nothing(creatorUsdc), usd(creatorUsdc));
      const pending = (await pub.readContract({ address: token, abi: launchTokenAbi, functionName: "pendingRewards", args: [account.address] })) as bigint;
      check("a holder can see a claim", pending > 0n, usd(pending));
      const before = await bal(USDC, account.address);
      const gasBefore = gasSpent6;
      await send({ address: token, abi: launchTokenAbi, functionName: "claimRewards", args: [] });
      check("and claim it, in USDC", (await bal(USDC, account.address)) - before + (gasSpent6 - gasBefore) === pending);
    }
    if (mode === "burn") {
      const l = (await pub.readContract({ address: LAUNCHPAD, abi: launchpadAbi, functionName: "launchOf", args: [token] })) as { tokensBurned: bigint; usdcSpentOnBuybacks: bigint };
      check("fees bought the token back and burned it", l.tokensBurned > 0n, `${Number(formatUnits(l.tokensBurned, 18)).toFixed(0)} tokens`);
      check("supply shrank by exactly that", supply0 - supply === l.tokensBurned);
      check("creator was not paid instead", nothing(creatorUsdc), usd(creatorUsdc));
      check("buy-back spent USDC, not tokens", l.usdcSpentOnBuybacks > 0n, usd(l.usdcSpentOnBuybacks));
    }
    if (mode === "project") {
      check("the project was paid", projectUsdc > 0n, usd(projectUsdc));
      check("in USDC only", (await bal(token, project)) === 0n);
      check("the creator earned nothing from it", nothing(creatorUsdc) && creatorTok === 0n, usd(creatorUsdc));
    }
  }

  console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILED`}  (${pass} checks)`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERROR:", e.shortMessage ?? e.message ?? e); process.exit(1); });
