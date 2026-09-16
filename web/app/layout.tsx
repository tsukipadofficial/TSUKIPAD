import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/Header";
import { SiteFooter } from "@/components/SiteFooter";
import { NAME, SITE_URL, TAGLINE, DESCRIPTION, SOCIAL_DESCRIPTION } from "@/lib/brand";
import { RPC_URL } from "@/lib/config";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

/// Fonts are self-hosted rather than pulled via `next/font/google`.
///
/// Google rotates the hashed file names behind `fonts.gstatic.com`, and the
/// subset URLs Next requests at build time started returning 404 — which fails
/// the whole build, on a third party's schedule. These are the same Latin
/// subsets Google serves, committed to the repo, so builds are reproducible and
/// work offline.
const spaceGrotesk = localFont({
  src: "../public/fonts/space-grotesk.woff2",
  variable: "--font-space-grotesk",
  display: "swap",
  // Variable font: one file covers the whole weight range.
  weight: "300 700",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

const jetbrainsMono = localFont({
  src: "../public/fonts/jetbrains-mono.woff2",
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: "100 800",
  fallback: ["ui-monospace", "monospace"],
});

const NOTO_JP_CSS =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap";

/// Japanese is loaded at runtime rather than bundled. Noto Sans JP is several
/// megabytes across its subsets, and only a fraction of visitors read Japanese
/// -- the browser fetches just the ranges it needs, and a fetch failure degrades
/// to a system CJK font instead of breaking the build the way the Latin fonts
/// did.
///
/// Inserted by script rather than written as a <link>. A stylesheet the parser
/// finds in <head> blocks first paint until Google answers, which put a
/// round-trip to fonts.googleapis.com in front of every page for every reader.
/// A script-inserted one is not render-blocking, and the request still leaves
/// the moment the head is parsed, so Japanese readers see the font no later.
const NOTO_JP_SCRIPT = `(function(){var l=document.createElement("link");l.rel="stylesheet";l.href=${JSON.stringify(
  NOTO_JP_CSS,
)};document.head.appendChild(l)})()`;

/// Origins the page will talk to as soon as its JavaScript runs: the RPC for
/// the board's first read, Privy for the session check. Opening the connection
/// during HTML parse takes DNS and TLS off that path. Only the origin: the
/// Alchemy key is in the URL path and already ships in the client bundle, but
/// there is no reason to write it into the HTML as well.
const RPC_ORIGIN = (() => {
  try {
    return new URL(RPC_URL).origin;
  } catch {
    return null;
  }
})();

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${NAME} — ${TAGLINE}`,
  description: DESCRIPTION,
  openGraph: {
    title: `${NAME} — ${TAGLINE}`,
    description: SOCIAL_DESCRIPTION,
    url: SITE_URL,
    siteName: NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${NAME} — ${TAGLINE}`,
    description: SOCIAL_DESCRIPTION,
  },
};

/// themeColor belongs on the viewport export in this Next version. Two entries
/// so the browser chrome matches the ground the head script picks for a first
/// visit; a later toggle is a live DOM change this static value cannot follow.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f1ea" },
    { media: "(prefers-color-scheme: dark)", color: "#08080a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
      /* the head script stamps data-theme before React hydrates */
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {RPC_ORIGIN ? <link rel="preconnect" href={RPC_ORIGIN} crossOrigin="" /> : null}
        <link rel="preconnect" href="https://auth.privy.io" crossOrigin="" />
        <script dangerouslySetInnerHTML={{ __html: NOTO_JP_SCRIPT }} />
        <noscript>
          <link rel="stylesheet" href={NOTO_JP_CSS} />
        </noscript>
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>
          <Header />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
