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
import { privyUserId } from "@/lib/privy-verify";

export const dynamic = "force-dynamic";

const ATTESTATION_TTL = 15 * 60; // seconds

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/// Ask Privy who this user is, in two steps because they answer two different
/// questions.
///
/// The access token proves a session, and it is a JWT this app can verify by
/// itself against Privy's public keys -- that yields the user's id and nothing
/// more. The linked accounts live on the user record, which is app-scoped data
/// and needs the app's own credentials, sent as Basic auth.
///
/// Conflating the two -- presenting the user's token where the app's belongs --
/// simply fails, and the failure looks to the visitor like their session
/// expired seconds after signing in.
async function privyUser(accessToken: string): Promise<Record<string, unknown> | null> {
  const secret = process.env.PRIVY_APP_SECRET;
  if (!secret) return null;

  const did = await privyUserId(accessToken);
  if (!did) return null;

  const auth = Buffer.from(`${PRIVY_APP_ID}:${secret}`).toString("base64");
  const res = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(did)}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      "privy-app-id": PRIVY_APP_ID,
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
  // Privy names X "twitter_oauth", and Telegram simply "telegram" -- it is not
  // an OAuth account in Privy's record.
  const want = provider === "x" ? "twitter_oauth" : provider === "telegram" ? "telegram" : `${provider}_oauth`;
  const found = accounts.find((a) => a.type === want);
  return found?.username ?? null;
}

/// Whether this server's signing key is the attestor the live launchpad trusts.
///
/// The launchpad's attestor is fixed at deploy, so a key left over from another
/// deployment signs attestations the contract will always reject -- a claim
/// that fails at the very last step, after the person has signed in and paid
/// gas, with nothing on the page to say why. Checked once and remembered.
let attestorMatches: Promise<boolean> | null = null;
function checkAttestor(key: `0x${string}`): Promise<boolean> {
  if (!attestorMatches) {
    const pub = createPublicClient({ chain, transport: http(RPC_URL) });
    attestorMatches = (
      pub.readContract({ address: LAUNCHPAD_ADDRESS, abi: launchpadAbi, functionName: "attestor" }) as Promise<string>
    )
      .then((onchain) => getAddress(onchain) === privateKeyToAccount(key).address)
      .catch(() => {
        attestorMatches = null; // an RPC hiccup is not a verdict; ask again next time
        return false;
      });
  }
  return attestorMatches;
}

export async function POST(req: NextRequest) {
  const key = process.env.ATTESTOR_PRIVATE_KEY;
  if (!key) return bad("attestor-not-configured", 503);
  if (!process.env.PRIVY_APP_SECRET) return bad("privy-not-configured", 503);
  if (!(await checkAttestor(key as `0x${string}`))) return bad("attestor-mismatch", 503);

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
  if (!username) {
    // A Telegram account can exist without a username, and a launch can only
    // have earmarked fees for a username. Say which problem it is.
    const accounts = (user.linked_accounts ?? user.linkedAccounts) as { type?: string }[] | undefined;
    if (provider === "telegram" && accounts?.some((a) => a.type === "telegram")) return bad("telegram-no-username");
    return bad("account-not-linked");
  }

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
