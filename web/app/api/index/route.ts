/// Cron entry point for the indexer.
///
/// Vercel calls this on a schedule. It is also callable by hand with the cron
/// secret, which is how you catch a pool up after adding one.

import { NextRequest, NextResponse } from "next/server";
import { redisConfigured } from "@/lib/redis";
import { runIndexer, syncPools } from "@/lib/indexer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Vercel signs its own cron invocations with this header.
  if (req.headers.get("x-vercel-cron")) return true;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  if (!redisConfigured) return NextResponse.json({ ok: false, error: "no-store" }, { status: 503 });

  const started = Date.now();
  try {
    if (req.nextUrl.searchParams.get("pools") === "sync") await syncPools();
    const result = await runIndexer();
    return NextResponse.json({ ok: true, ms: Date.now() - started, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : "failed" },
      { status: 500 },
    );
  }
}
