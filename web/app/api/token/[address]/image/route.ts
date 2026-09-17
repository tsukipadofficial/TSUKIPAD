/// GET /api/token/:address/image
///
/// The token's logo as an ordinary image, decoded from the data URI its
/// metadata carries on-chain. Integrations can put this URL straight into an
/// <img> tag. A token whose image is a normal https or ipfs link is redirected
/// there instead.

import { NextResponse } from "next/server";

import { PUBLIC_HEADERS, tokenInfo } from "@/lib/tokeninfo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/// Raster formats only. An SVG served from this domain could carry script, and
/// the create page never produces one.
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/// A launched token's metadata is immutable, so its image can be cached for as
/// long as any cache will keep it.
const FOREVER = "public, max-age=31536000, s-maxage=31536000, immutable";

export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;

  let found;
  try {
    found = await tokenInfo(address);
  } catch {
    return new NextResponse(null, { status: 503, headers: { ...PUBLIC_HEADERS, "Cache-Control": "no-store" } });
  }
  const uri = found?.imageUri;
  if (!found || !uri) {
    return new NextResponse(null, { status: 404, headers: { ...PUBLIC_HEADERS, "Cache-Control": "public, s-maxage=60" } });
  }

  const data = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(uri);
  if (data) {
    const type = data[1].toLowerCase();
    if (!ALLOWED.has(type)) {
      return new NextResponse(null, { status: 415, headers: PUBLIC_HEADERS });
    }
    const bytes = Buffer.from(data[2].replace(/\s/g, ""), "base64");
    return new NextResponse(bytes, {
      headers: {
        ...PUBLIC_HEADERS,
        "Content-Type": type,
        "Content-Length": String(bytes.length),
        "Cache-Control": FOREVER,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  }

  if (uri.startsWith("https://")) {
    return NextResponse.redirect(uri, { status: 302, headers: { ...PUBLIC_HEADERS, "Cache-Control": FOREVER } });
  }
  if (uri.startsWith("ipfs://")) {
    return NextResponse.redirect(`https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`, {
      status: 302,
      headers: { ...PUBLIC_HEADERS, "Cache-Control": FOREVER },
    });
  }
  return new NextResponse(null, { status: 404, headers: PUBLIC_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_HEADERS });
}
