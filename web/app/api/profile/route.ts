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
import { generateName } from "@/lib/names";

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
  /// Picture URL, normally lifted from the linked social account at save time.
  /// Only https is accepted -- a profile is rendered to every visitor, so a
  /// javascript: or data:text/html value here would be stored XSS.
  avatar: string | null;
  wallet: string | null;
  createdAt: number;
};

function safeAvatar(url: unknown, fallback: string | null): string | null {
  if (typeof url !== "string") return fallback;
  const t = url.trim();
  if (!t) return null;
  if (!t.startsWith("https://") || t.length > 400) return fallback;
  return t;
}

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

  let body: {
    accessToken?: string; handle?: string; display?: string;
    bio?: string; wallet?: string; avatar?: string;
  };
  try {
    body = await req.json();
  } catch {
    return bad("bad-json");
  }

  const did = await privyUserId(body.accessToken);
  if (!did) return bad("not-signed-in", 401);

  const existingRaw0 = await cmd<string | null>("GET", K.byDid(did));

  // ---- auto-provision ----------------------------------------------------
  // No handle supplied means "just make sure I have a profile". Signing in is
  // enough to be on the board; nobody should have to fill in a form first.
  if (!body.handle) {
    if (existingRaw0) {
      // Idempotent: an account that already has a name keeps it. Still worth
      // recording the wallet, because the profile is useless without one and
      // the wallet may have been connected after the profile was made.
      const p: Profile = JSON.parse(existingRaw0);
      const w = body.wallet && isAddress(body.wallet) ? getAddress(body.wallet) : p.wallet;
      const avatar = safeAvatar(body.avatar, p.avatar);
      if (w !== p.wallet || avatar !== p.avatar) {
        const next: Profile = { ...p, wallet: w, avatar };
        const writes: (string | number)[][] = [["SET", K.byDid(did), JSON.stringify(next)]];
        if (w) writes.push(["SET", K.byWallet(w), did]);
        await pipeline(writes);
        return NextResponse.json({ ok: true, profile: next });
      }
      return NextResponse.json({ ok: true, profile: p });
    }

    const wallet0 = body.wallet && isAddress(body.wallet) ? getAddress(body.wallet) : null;

    // SET NX is the whole concurrency story: two accounts that generate the
    // same name race for the key and exactly one wins. Checking-then-writing
    // would let both through and give two people the same handle.
    for (let attempt = 0; attempt < 12; attempt++) {
      const gen = generateName(attempt);
      const won = await cmd<string | null>("SET", K.byHandle(gen.handle), did, "NX");
      if (!won) continue;

      const profile: Profile = {
        did,
        handle: gen.handle,
        display: gen.display,
        bio: "",
        avatar: safeAvatar(body.avatar, null),
        wallet: wallet0,
        createdAt: Date.now(),
      };
      const writes: (string | number)[][] = [["SET", K.byDid(did), JSON.stringify(profile)]];
      if (wallet0) writes.push(["SET", K.byWallet(wallet0), did]);
      await pipeline(writes);
      return NextResponse.json({ ok: true, profile, generated: true });
    }
    // Twelve collisions in a row means the namespace is genuinely exhausted,
    // not that this request was unlucky.
    return bad("no-name-available", 503);
  }

  // ---- explicit rename ---------------------------------------------------
  const handle = body.handle.trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) return bad("bad-handle");

  // Handles are first-come and cannot be stolen. SET NX rather than GET-then-SET:
  // two people submitting the same name at once would both pass a read check and
  // the second write would silently take the name from the first.
  const claimed = await cmd<string | null>("SET", K.byHandle(handle), did, "NX");
  if (!claimed) {
    const owner = await cmd<string | null>("GET", K.byHandle(handle));
    if (owner !== did) return bad("handle-taken", 409);
  }

  const existing: Profile | null = existingRaw0 ? JSON.parse(existingRaw0) : null;

  const wallet = body.wallet && isAddress(body.wallet) ? getAddress(body.wallet) : existing?.wallet ?? null;

  const profile: Profile = {
    did,
    handle,
    display: (body.display ?? existing?.display ?? handle).slice(0, 40),
    bio: (body.bio ?? existing?.bio ?? "").slice(0, 160),
    avatar: safeAvatar(body.avatar, existing?.avatar ?? null),
    wallet,
    createdAt: existing?.createdAt ?? Date.now(),
  };

  const writes: (string | number)[][] = [["SET", K.byDid(did), JSON.stringify(profile)]];
  // Release a handle the account is moving away from, so it is not orphaned.
  if (existing && existing.handle !== handle) writes.push(["DEL", K.byHandle(existing.handle)]);
  if (wallet) writes.push(["SET", K.byWallet(wallet), did]);
  await pipeline(writes);

  return NextResponse.json({ ok: true, profile });
}
