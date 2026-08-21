/// Binding a referral to an account instead of a browser.
///
/// A `?ref=` link can only leave something in the browser that opened it. Click
/// on a phone and launch on a laptop and the credit is gone, which is most of
/// the referrals a link would actually earn. Keyed to the Privy account, it
/// survives devices, cleared storage and months of delay.
///
/// Binding is once and never again. If it could be rewritten, anyone could
/// re-point themselves at their own second wallet the day before launching and
/// take the referral off whoever actually found them.

import { NextRequest, NextResponse } from "next/server";
import { isAddress, getAddress } from "viem";

import { cmd, redisConfigured } from "@/lib/redis";
import { privyUserId } from "@/lib/privy-verify";

export const dynamic = "force-dynamic";

const key = (did: string) => `ref:user:${did}`;

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/// Who referred the signed-in account, if anyone.
export async function GET(req: NextRequest) {
  if (!redisConfigured) return NextResponse.json({ ok: true, referrer: null });
  const did = await privyUserId(req.headers.get("authorization")?.replace(/^Bearer /, ""));
  if (!did) return bad("not-signed-in", 401);
  const referrer = await cmd<string | null>("GET", key(did));
  return NextResponse.json({ ok: true, referrer: referrer ?? null });
}

/// Record a referrer for the signed-in account. First write wins.
export async function POST(req: NextRequest) {
  if (!redisConfigured) return bad("unavailable", 503);

  let body: { accessToken?: string; referrer?: string };
  try {
    body = await req.json();
  } catch {
    return bad("bad-json");
  }

  const did = await privyUserId(body.accessToken);
  if (!did) return bad("not-signed-in", 401);
  if (!body.referrer || !isAddress(body.referrer)) return bad("bad-referrer");

  const referrer = getAddress(body.referrer);
  const existing = await cmd<string | null>("GET", key(did));
  if (existing) {
    // Already attributed. Not an error -- the client sends this on every sign-in.
    return NextResponse.json({ ok: true, referrer: existing, changed: false });
  }

  // SET NX: two sign-ins racing on different devices cannot both win.
  await cmd("SET", key(did), referrer, "NX");
  const stored = await cmd<string | null>("GET", key(did));
  return NextResponse.json({ ok: true, referrer: stored ?? referrer, changed: stored === referrer });
}
