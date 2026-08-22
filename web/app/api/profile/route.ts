/// Profiles, keyed to the Privy account rather than to a wallet.
///
/// A wallet is not a person -- embedded wallets are minted per account and
/// someone may connect a different one later. Keying on the account keeps a
/// profile attached to whoever owns it, and lets the verified social handle
/// Privy already knows about be the thing shown next to a name.

import { NextRequest, NextResponse } from "next/server";
import { isAddress, getAddress } from "viem";

import { cmd, pipeline, redisConfigured } from "@/lib/redis";
import { privyUserId } from "@/lib/privy-verify";

export const dynamic = "force-dynamic";

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

const K = {
  byDid: (did: string) => `profile:did:${did}`,
  byHandle: (h: string) => `profile:handle:${h.toLowerCase()}`,
  byWallet: (a: string) => `profile:wallet:${a.toLowerCase()}`,
};

export type Profile = {
  did: string;
  handle: string;
  display: string;
  bio: string;
  wallet: string | null;
  createdAt: number;
};

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/// Look a profile up by handle or by wallet. Public: this is what renders on a
/// profile page for visitors who are not signed in.
export async function GET(req: NextRequest) {
  if (!redisConfigured) return NextResponse.json({ ok: true, profile: null });

  const handle = req.nextUrl.searchParams.get("handle");
  const wallet = req.nextUrl.searchParams.get("wallet");

  let did: string | null = null;
  if (handle) did = await cmd<string | null>("GET", K.byHandle(handle));
  else if (wallet && isAddress(wallet)) did = await cmd<string | null>("GET", K.byWallet(wallet));
  else {
    // No lookup key: answer for whoever is signed in.
    did = await privyUserId(req.headers.get("authorization")?.replace(/^Bearer /, ""));
  }

  if (!did) return NextResponse.json({ ok: true, profile: null });
  const raw = await cmd<string | null>("GET", K.byDid(did));
  return NextResponse.json({ ok: true, profile: raw ? JSON.parse(raw) : null });
}

/// Create or update the signed-in account's profile.
export async function POST(req: NextRequest) {
  if (!redisConfigured) return bad("unavailable", 503);

  let body: { accessToken?: string; handle?: string; display?: string; bio?: string; wallet?: string };
  try {
    body = await req.json();
  } catch {
    return bad("bad-json");
  }

  const did = await privyUserId(body.accessToken);
  if (!did) return bad("not-signed-in", 401);

  const handle = (body.handle ?? "").trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) return bad("bad-handle");

  // Handles are first-come and cannot be stolen: a name already pointing at a
  // different account is refused rather than reassigned.
  const owner = await cmd<string | null>("GET", K.byHandle(handle));
  if (owner && owner !== did) return bad("handle-taken", 409);

  const existingRaw = await cmd<string | null>("GET", K.byDid(did));
  const existing: Profile | null = existingRaw ? JSON.parse(existingRaw) : null;

  const wallet = body.wallet && isAddress(body.wallet) ? getAddress(body.wallet) : existing?.wallet ?? null;

  const profile: Profile = {
    did,
    handle,
    display: (body.display ?? existing?.display ?? handle).slice(0, 40),
    bio: (body.bio ?? existing?.bio ?? "").slice(0, 160),
    wallet,
    createdAt: existing?.createdAt ?? Date.now(),
  };

  const writes: (string | number)[][] = [
    ["SET", K.byDid(did), JSON.stringify(profile)],
    ["SET", K.byHandle(handle), did],
  ];
  // Release a handle the account is moving away from, so it is not orphaned.
  if (existing && existing.handle !== handle) writes.push(["DEL", K.byHandle(existing.handle)]);
  if (wallet) writes.push(["SET", K.byWallet(wallet), did]);
  await pipeline(writes);

  return NextResponse.json({ ok: true, profile });
}
