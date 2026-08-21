/// Exercises the exact code path the browser uses to launch a token, against the
/// real Arc testnet.
///
/// The risky part of the UI flow is client-side: the browser mines a CREATE2
/// salt and predicts the token address itself. If that prediction disagrees with
/// what the contract actually deploys, `launch` reverts with BadTokenOrdering
/// and every launch from the website fails. Scripts that mine on-chain would
/// never catch it.
///
/// This imports the frontend's own modules — no reimplementation — so a pass
/// here means the website's launch button works.
///
///   pnpm exec tsx scripts/verify-ui-launch.ts

import { createPublicClient, createWalletClient, http, parseUnits, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { readFileSync } from "node:fs";

import { launchpadAbi } from "../lib/abi";
import { mineSalt } from "../lib/launch-math";
import { encodeMetadata } from "../lib/metadata";
import {
  startTickForMarketCap,
  ceilingTick,
  marketCapAtTick,
  curveCapacityUsd,
} from "../lib/launch-math";

const RPC = "https://rpc.testnet.arc.io";
const LAUNCHPAD = "0xe71877119585Ab59A12B95ED35A023280476d5Dc" as const;

function loadKey(): `0x${string}` {
  const env = readFileSync(new URL("../../.secrets/deployer.env", import.meta.url), "utf8");
  const m = env.match(/ARC_DEPLOYER_KEY=(0x[0-9a-fA-F]+)/);
  if (!m) throw new Error("deployer key not found");
  return m[1] as `0x${string}`;
}

async function main() {
  const account = privateKeyToAccount(loadKey());
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC) });
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(RPC) });

  console.log("launching as", account.address, "\n");

  // --- exactly what the create form computes -------------------------------
  const name = "UI Path Token";
  const symbol = "UIPATH";
  const supply = 1_000_000_000n;
  const totalSupplyWei = parseUnits(supply.toString(), 18);

  const metadataURI = encodeMetadata({
    description: "Launched through the website's own code path.",
    twitter: "@tsukipad_",
    telegram: "t.me/tsukipadofficial",
  });

  const tickLower = startTickForMarketCap(3_000, supply);
  const tickUpper = ceilingTick(tickLower, 1_000);

  console.log("form preview would show:");
  console.log("  opens at   $", marketCapAtTick(tickLower, supply).toFixed(0));
  console.log("  ceiling    $", marketCapAtTick(tickUpper, supply).toFixed(0));
  console.log("  fills at   $", curveCapacityUsd(tickLower, tickUpper, supply).toFixed(0));
  console.log("  metadata     ", metadataURI.length, "bytes\n");

  // --- the browser-side salt mining ----------------------------------------
  const initCodeHash = (await publicClient.readContract({
    address: LAUNCHPAD,
    abi: launchpadAbi,
    functionName: "tokenInitCodeHash",
    args: [account.address, name, symbol, totalSupplyWei, metadataURI, false],
  })) as `0x${string}`;

  const { salt, token: predicted, attempts } = mineSalt(LAUNCHPAD, account.address, initCodeHash);
  console.log("browser mined salt in", attempts, "attempts");
  console.log("  predicted token address:", predicted);

  // Cross-check against the contract's own prediction before spending gas.
  const onchainPrediction = (await publicClient.readContract({
    address: LAUNCHPAD,
    abi: launchpadAbi,
    functionName: "predictTokenAddress",
    args: [account.address, name, symbol, totalSupplyWei, metadataURI, false, salt],
  })) as string;

  console.log("  contract says          :", onchainPrediction);
  if (predicted.toLowerCase() !== onchainPrediction.toLowerCase()) {
    throw new Error("MISMATCH — the browser prediction disagrees with the contract");
  }
  console.log("  ✓ match\n");

  // --- submit --------------------------------------------------------------
  const hash = await walletClient.writeContract({
    address: LAUNCHPAD,
    abi: launchpadAbi,
    functionName: "launch",
    args: [
      {
        name,
        symbol,
        metadataURI,
        totalSupply: totalSupplyWei,
        salt,
        tickLower,
        tickUpper,
        creatorAllocationBps: 0,
        rewardHolders: false,
        feeRecipient: "0x0000000000000000000000000000000000000000",
        buybackAndBurn: false,
        recipientCommitment: ("0x" + "0".repeat(64)) as `0x${string}`,
        referrer: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      },
    ],
  });
  console.log("tx:", hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("status:", receipt.status, "| gas:", receipt.gasUsed.toString());

  for (const log of receipt.logs) {
    try {
      const parsed = decodeEventLog({ abi: launchpadAbi, data: log.data, topics: log.topics });
      if (parsed.eventName === "Launched") {
        const args = parsed.args as { token: string; pool: string };
        console.log("\nLaunched event:");
        console.log("  token:", args.token);
        console.log("  pool :", args.pool);
        if (args.token.toLowerCase() !== predicted.toLowerCase()) {
          throw new Error("deployed address differs from the browser prediction");
        }
        console.log("  ✓ deployed address matches the browser prediction exactly");
      }
    } catch {
      /* not our event */
    }
  }
}

main().catch((e) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
