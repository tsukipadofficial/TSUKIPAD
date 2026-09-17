/// GET /api/chart?token=0x…
///
/// One-minute market-cap candles for a TSUKIPAD token, from every on-chain
/// trade. `complete` is false while history is still being filled in; the
/// chart keeps polling and the gaps close on their own.

import { NextResponse } from "next/server";

import { chartFor } from "@/lib/chart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  try {
    const result = await chartFor(token);
    if (!result) return NextResponse.json({ error: "not_a_tsukipad_token" }, { status: 404 });
    return NextResponse.json(result, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        // Many viewers of one hot token share one upstream read.
        "Cache-Control": result.complete
          ? "public, s-maxage=5, stale-while-revalidate=20"
          : "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
