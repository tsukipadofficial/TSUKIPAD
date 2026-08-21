/// Waitlist API.
///
///   GET  -> public board (ranked by join time) + total
///   POST -> join with an X handle, optionally attach a signed wallet
///
/// Rank is join order, not activity: the reward for boarding early should be
/// being early, which is not farmable by posting more.

import { NextRequest, NextResponse } from "next/server";

import { cmd, pipeline, redisConfigured } from "@/lib/redis";
import {
  Entry,
  K,
  clearance,
  normaliseAddress,
  normaliseHandle,
  signatureValid,
} from "@/lib/waitlist";

export const dynamic = "force-dynamic";

const BOARD_LIMIT = 100;
const RATE_MAX = 12;         // joins per IP…
const RATE_WINDOW = 60 * 60; // …per hour

function ipOf(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? "unknown").trim();
}

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET() {
  if (!redisConfigured) {
    return NextResponse.json({ ok: true, total: 0, board: [], configured: false });
  }
  const handles = await cmd<string[]>("ZRANGE", K.board, 0, BOARD_LIMIT - 1);
  const raw = handles.length
    ? await pipeline<string | null>(handles.map((h) => ["GET", K.entry(h)]))
    : [];
  const board = raw
    .filter((r): r is string => Boolean(r))
    .map((r) => JSON.parse(r) as Entry)
    .map((e, i) => ({
      rank: i + 1,
      display: e.display,
      clearance: clearance(e),
    }));
  const total = Number(await cmd<number>("GET", K.count)) || board.length;
  return NextResponse.json({ ok: true, total, board, configured: true });
}

export async function POST(req: NextRequest) {
  if (!redisConfigured) return bad("waitlist-unavailable", 503);

  let body: { handle?: string; address?: string; signature?: string };
  try {
    body = await req.json();
  } catch {
    return bad("bad-json");
  }

  const handle = normaliseHandle(body.handle ?? "");
  if (!handle) return bad("bad-handle");
  const key = handle.toLowerCase();

  // Rate limit only well-formed attempts: counting malformed ones lets a user
  // lock themselves out by typing their own handle wrong twice.
  const ip = ipOf(req);
  const hits = await cmd<number>("INCR", K.rate(ip));
  if (hits === 1) await cmd("EXPIRE", K.rate(ip), RATE_WINDOW);
  if (hits > RATE_MAX) return bad("rate-limited", 429);

  // A wallet only counts when it is signed -- pasting an address you do not
  // control gets you nothing, which is what keeps the board honest.
  let address: string | null = null;
  if (body.address) {
    address = normaliseAddress(body.address);
    if (!address) return bad("bad-address");
    if (!body.signature) return bad("signature-required");
    if (!(await signatureValid(handle, address, body.signature))) {
      return bad("bad-signature");
    }
    const owner = await cmd<string | null>("GET", K.addr(address));
    if (owner && owner !== key) return bad("address-taken", 409);
  }

  const existingRaw = await cmd<string | null>("GET", K.entry(key));
  const now = Date.now();
  const existing = existingRaw ? (JSON.parse(existingRaw) as Entry) : null;

  const entry: Entry = existing
    ? {
        ...existing,
        display: existing.display,
        address: address ?? existing.address,
        verifiedAt: address ? (existing.verifiedAt ?? now) : existing.verifiedAt,
      }
    : {
        handle: key,
        display: handle,
        address,
        createdAt: now,
        verifiedAt: address ? now : null,
      };

  const writes: (string | number)[][] = [["SET", K.entry(key), JSON.stringify(entry)]];
  if (!existing) {
    // Score by join time so rank is stable and reflects who was actually first.
    writes.push(["ZADD", K.board, entry.createdAt, key], ["INCR", K.count]);
  }
  if (address) writes.push(["SET", K.addr(address), key]);
  await pipeline(writes);

  const rank = await cmd<number | null>("ZRANK", K.board, key);
  return NextResponse.json({
    ok: true,
    handle: entry.display,
    clearance: clearance(entry),
    rank: rank === null ? null : rank + 1,
    isNew: !existing,
  });
}
