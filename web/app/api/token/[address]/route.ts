/// GET /api/token/:address
///
/// Everything a wallet, bot or explorer needs to list a TSUKIPAD token: name,
/// logo, links, launch type, pool key and the real fees including the hook's
/// creator tax. 404 when TSUKIPAD did not launch the address.

import { NextResponse } from "next/server";

import { PUBLIC_HEADERS, tokenInfo } from "@/lib/tokeninfo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  try {
    const found = await tokenInfo(address);
    if (!found) {
      return NextResponse.json(
        { error: "not_a_tsukipad_token", address },
        { status: 404, headers: { ...PUBLIC_HEADERS, "Cache-Control": "public, s-maxage=60" } },
      );
    }
    return NextResponse.json(found.info, {
      headers: {
        ...PUBLIC_HEADERS,
        // Short: only graduation changes, and bots should see it promptly.
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
      },
    });
  } catch {
    // An RPC hiccup must not read as "not a TSUKIPAD token".
    return NextResponse.json(
      { error: "temporarily_unavailable" },
      { status: 503, headers: { ...PUBLIC_HEADERS, "Cache-Control": "no-store" } },
    );
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_HEADERS });
}
