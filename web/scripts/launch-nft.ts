/// One real launch on the deployed contract, earmarked to an X account.
///
/// Everything about this path has been proven in Foundry against a simulated
/// pool. Nothing has been proven against the contract that is actually
/// deployed. This is that run: launch, trade both ways, collect, and check the
/// fees landed in escrow rather than in anyone's wallet.
///
///   pnpm exec tsx scripts/launch-nft.ts

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { readFileSync } from "node:fs";

import { launchpadAbi, swapRouterAbi, erc20Abi } from "../lib/abi";
import { mineSalt, startTickForMarketCap, ceilingTick } from "../lib/launch-math";
import { encodeMetadata } from "../lib/metadata";
import { commitmentFor } from "../lib/commitment";

const RPC = "https://rpc.testnet.arc.io";
const LAUNCHPAD = "0x0887CB9E7Da9488055F62800d22Ad2aAB57e4504" as const;
const ROUTER = "0x5920274784685bEF0Ad09C18c2380f9244882c09" as const;
const USDC = "0x3600000000000000000000000000000000000000" as const;

const NAME = "Never Fucking Trade";
const SYMBOL = "NFT";
const HANDLE = "tsukipad_";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadKey(): `0x${string}` {
  const env = readFileSync(new URL("../../.secrets/deployer.env", import.meta.url), "utf8");
  const m = env.match(/ARC_DEPLOYER_KEY=(0x[0-9a-fA-F]+)/);
  if (!m) throw new Error("deployer key not found");
  return m[1] as `0x${string}`;
}

const usd = (v: bigint) => `$${formatUnits(v, 6)}`;

async function main() {
  const account = privateKeyToAccount(loadKey());
  const pub = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(RPC) });

  const image = readFileSync("/tmp/nft.webp").toString("base64");
  const metadataURI = encodeMetadata({
    description: "Never Fucking Trade. Fees earmarked for @tsukipad_, unclaimed.",
    image: `data:image/webp;base64,${image}`,
    twitter: "@tsukipad_",
  });

  const supply = 1_000_000_000n;
  const totalSupplyWei = parseUnits(supply.toString(), 18);
  const tickLower = startTickForMarketCap(3_000, supply);
  const tickUpper = ceilingTick(tickLower, 10_000);
  const commitment = commitmentFor("x", HANDLE)!;

  console.log(`launching ${NAME} ($${SYMBOL}) as ${account.address}`);
  console.log("  metadata     ", metadataURI.length, "bytes");
  console.log("  earmarked to  x:" + HANDLE);
  console.log("  commitment    " + commitment + "\n");

  const initCodeHash = (await pub.readContract({
    address: LAUNCHPAD, abi: launchpadAbi, functionName: "tokenInitCodeHash",
    args: [account.address, NAME, SYMBOL, totalSupplyWei, metadataURI, false],
  })) as `0x${string}`;

  const { salt, token, attempts } = mineSalt(LAUNCHPAD, account.address, initCodeHash);
  console.log(`mined salt in ${attempts} attempts -> ${token}\n`);

  const hash = await wallet.writeContract({
    address: LAUNCHPAD, abi: launchpadAbi, functionName: "launch",
    args: [{
      name: NAME, symbol: SYMBOL, metadataURI, totalSupply: totalSupplyWei, salt,
      tickLower, tickUpper, creatorAllocationBps: 0, rewardHolders: false,
      feeRecipient: "0x0000000000000000000000000000000000000000",
      buybackAndBurn: false,
      recipientCommitment: commitment,
      referrer: "0x0000000000000000000000000000000000000000",
    }],
  });
  await pub.waitForTransactionReceipt({ hash });
  console.log("launched:", hash);

  const launch = (await pub.readContract({
    address: LAUNCHPAD, abi: launchpadAbi, functionName: "launchOf", args: [token],
  })) as { feeRecipient: string; pool: string };
  console.log("  pool          ", launch.pool);
  console.log("  feeRecipient  ", launch.feeRecipient, "(zero = earmarked, unclaimed)\n");

  // --- trade both ways so fees accrue on both sides ------------------------
  await sleep(2000);
  const spend = parseUnits("5", 6);
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: USDC, abi: erc20Abi, functionName: "approve", args: [ROUTER, spend],
    }),
  });
  await sleep(1500);
  const buyHash = await wallet.writeContract({
    address: ROUTER, abi: swapRouterAbi, functionName: "exactInputSingle",
    args: [{
      tokenIn: USDC, tokenOut: token, fee: 10_000, recipient: account.address,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 600), amountIn: spend, amountOutMinimum: 0n,
    }],
  });
  await pub.waitForTransactionReceipt({ hash: buyHash });
  const bought = (await pub.readContract({
    address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
  })) as bigint;
  console.log("bought", formatUnits(bought, 18), SYMBOL);

  await sleep(1500);
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: token, abi: erc20Abi, functionName: "approve", args: [ROUTER, bought],
    }),
  });
  await sleep(1500);
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: ROUTER, abi: swapRouterAbi, functionName: "exactInputSingle",
      args: [{
        tokenIn: token, tokenOut: USDC, fee: 10_000, recipient: account.address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 600), amountIn: bought, amountOutMinimum: 0n,
      }],
    }),
  });
  console.log("sold it back — fees now accrued on both sides\n");

  // --- collect -------------------------------------------------------------
  await sleep(2000);
  const treasury = (await pub.readContract({
    address: LAUNCHPAD, abi: launchpadAbi, functionName: "treasury",
  })) as `0x${string}`;
  const treasuryBefore = (await pub.readContract({
    address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [treasury],
  })) as bigint;

  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: LAUNCHPAD, abi: launchpadAbi, functionName: "collectFees", args: [token],
    }),
  });
  await sleep(1500);

  const escrowUsdc = (await pub.readContract({
    address: LAUNCHPAD, abi: launchpadAbi, functionName: "escrowUsdc", args: [token],
  })) as bigint;
  const escrowToken = (await pub.readContract({
    address: LAUNCHPAD, abi: launchpadAbi, functionName: "escrowToken", args: [token],
  })) as bigint;
  const treasuryAfter = (await pub.readContract({
    address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [treasury],
  })) as bigint;

  console.log("after collectFees:");
  console.log("  escrow USDC      ", usd(escrowUsdc), " <- held for @" + HANDLE);
  console.log("  escrow token     ", formatUnits(escrowToken, 18), "(0 means it was converted)");
  console.log("  treasury received", usd(treasuryAfter - treasuryBefore));
  console.log("\ntoken:", token);
  console.log("claim at: https://www.tsukipad.com/claim");
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message.split("\n")[0] : e);
  process.exit(1);
});
