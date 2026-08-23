/// Holds the whole site behind the waitlist until mainnet.
///
/// Everything except the waitlist itself redirects to it. The gate is a single
/// env flag (`NEXT_PUBLIC_SITE_OPEN`) so opening the doors on mainnet day is a
/// value change and a redeploy, not a revert.

import { NextResponse, type NextRequest } from "next/server";

import { SITE_OPEN } from "@/lib/gate";

/// Reachable while closed. The waitlist needs its own page and its own API;
/// the icon and OG image need to stay public or every link anyone has already
/// shared loses its preview card.
const OPEN_EXACT = new Set(["/waitlist", "/icon.svg", "/opengraph-image", "/favicon.ico"]);

/// `/api/index` is the indexer cron. It already checks its own secret, and
/// letting it keep running means the boards are current the moment we open
/// rather than starting a long backfill that day.
const OPEN_PREFIX = ["/api/waitlist", "/api/index"];

function allowed(pathname: string): boolean {
  return OPEN_EXACT.has(pathname) || OPEN_PREFIX.some((p) => pathname.startsWith(p));
}

export function middleware(req: NextRequest) {
  if (SITE_OPEN) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (allowed(pathname)) return NextResponse.next();

  // A preview token lets us walk the real site while it is closed. Set as a
  // cookie on first use so the whole session works, not just the one URL.
  const token = process.env.SITE_PREVIEW_TOKEN;
  if (token) {
    if (req.cookies.get("tsukipad_preview")?.value === token) return NextResponse.next();
    if (req.nextUrl.searchParams.get("preview") === token) {
      const url = req.nextUrl.clone();
      url.searchParams.delete("preview");
      const res = NextResponse.redirect(url);
      res.cookies.set("tsukipad_preview", token, {
        httpOnly: true,
        sameSite: "lax",
        // Secure only where there is TLS -- a `secure` cookie is dropped over
        // plain http, which would make the bypass untestable on localhost.
        secure: req.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
      return res;
    }
  }

  // An API call must not be answered with the waitlist's HTML -- a fetch that
  // gets a 200 full of markup is far harder to diagnose than a plain 404.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "closed" }, { status: 404 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/waitlist";

  // Keep `?ref=` across the redirect. Referral links are the thing we are
  // asking people to share; dropping the code here would silently uncredit
  // every referrer for the whole pre-launch period.
  const ref = req.nextUrl.searchParams.get("ref");
  url.search = ref ? `?ref=${encodeURIComponent(ref)}` : "";

  // 307, never 308: a permanent redirect is cached by the browser and would go
  // on sending people to the waitlist after the site opens.
  return NextResponse.redirect(url, 307);
}

export const config = {
  // Static assets are served without ever entering the gate.
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?|mp4)$).*)"],
};
