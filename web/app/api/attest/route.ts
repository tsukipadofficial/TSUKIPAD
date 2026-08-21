/// Attests that a wallet belongs to the account a launch earmarked its fees for.
///
/// Whether an X or GitHub account belongs to a wallet cannot be decided on-chain,
/// so it is decided here and signed. The contract then checks only the signature,
/// which keeps the trusted part small and auditable: this service can bind an
/// address to a launch whose commitment it names, once, and nothing else.
///
/// Two things must both hold before anything is signed:
///   1. Privy says the caller really controls that social account, and
///   2. the account hashes to the commitment that launch was created with.

import { NextRequest, NextResponse } from "next/server";
import { createWalletClient, http, keccak256, encodeAbiParameters, isAddress, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient } from "viem";

import { launchpadAbi } from "@/lib/abi";
import { LAUNCHPAD_ADDRESS, RPC_URL, chain, PRIVY_APP_ID } from "@/lib/config";
import { commitmentFor, PROVIDERS, type Provider } from "@/lib/commitment";

export const dynamic = "force-dynamic";

const ATTESTATION_TTL = 15 * 60; // seconds

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/// Ask Privy who this user is. The access token proves the session; the user
/// record carries the linked accounts, which is what we actually need. Reading
/// it requires the app secret, so it can only happen server-side.
async function privyUser(accessToken: string): Promise<Record<string, unknown> | null> {
  const secret = process.env.PRIVY_APP_SECRET;
  if (!secret) return null;
  const auth = Buffer.from(`${PRIVY_APP_ID}:${secret}`).toString("base64");
  const res = await fetch("https://auth.privy.io/api/v1/users/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "privy-app-id": PRIVY_APP_ID,
      "privy-app-secret-auth": `Basic ${auth}`,
    },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, unknown>;
}

/// Pull the verified handle for a provider out of Privy's linked accounts.
function handleFor(user: Record<string, unknown>, provider: Provider): string | null {
  const accounts = (user.linked_accounts ?? user.linkedAccounts) as
    | { type?: string; username?: string }[]
    | undefined;
  if (!Array.isArray(accounts)) return null;
  const want = provider === "x" ? "twitter_oauth" : `${provider}_oauth`;
  const found = accounts.find((a) => a.type === want);
  return found?.username ?? null;
}

export async function POST(req: NextRequest) {
  const key = process.env.ATTESTOR_PRIVATE_KEY;
  if (!key) return bad("attestor-not-configured", 503);
  if (!process.env.PRIVY_APP_SECRET) return bad("privy-not-configured", 503);

  let body: { token?: string; provider?: string; recipient?: string; accessToken?: string };
  try {
    body = await req.json();
  } catch {
    return bad("bad-json");
  }

  const provider = body.provider as Provider;
  if (!PROVIDERS.includes(provider)) return bad("bad-provider");
  if (!body.token || !isAddress(body.token)) return bad("bad-token");
  if (!body.recipient || !isAddress(body.recipient)) return bad("bad-recipient");
  if (!body.accessToken) return bad("not-signed-in", 401);

  const user = await privyUser(body.accessToken);
  if (!user) return bad("not-signed-in", 401);

  const username = handleFor(user, provider);
  if (!username) return bad("account-not-linked");

  const claimed = commitmentFor(provider, username);
  if (!claimed) return bad("account-not-linked");

  // What the launch actually committed to, read from the chain rather than
  // trusted from the caller.
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const onchain = (await publicClient.readContract({
    address: LAUNCHPAD_ADDRESS,
    abi: launchpadAbi,
    functionName: "recipientCommitment",
    args: [getAddress(body.token)],
  })) as `0x${string}`;

  if (onchain === `0x${"0".repeat(64)}`) return bad("not-earmarked");
  if (onchain.toLowerCase() !== claimed.toLowerCase()) return bad("not-your-earmark", 403);

  const deadline = BigInt(Math.floor(Date.now() / 1000) + ATTESTATION_TTL);

  // Bound to this chain and this contract so the signature is worthless
  // anywhere else, and to one launch, one recipient and one commitment.
  const digest = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" }, { type: "address" }, { type: "address" },
        { type: "address" }, { type: "bytes32" }, { type: "uint64" },
      ],
      [
        BigInt(chain.id), LAUNCHPAD_ADDRESS, getAddress(body.token),
        getAddress(body.recipient), onchain, deadline,
      ],
    ),
  );

  const attestor = privateKeyToAccount(key as `0x${string}`);
  const signature = await attestor.signMessage({ message: { raw: digest } });

  return NextResponse.json({
    ok: true,
    handle: username,
    deadline: deadline.toString(),
    signature,
    attestor: attestor.address,
  });
}
