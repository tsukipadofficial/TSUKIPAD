import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/Header";
import { SiteFooter } from "@/components/SiteFooter";
import { NAME, SITE_URL, TAGLINE, DESCRIPTION, SOCIAL_DESCRIPTION } from "@/lib/brand";

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

/// themeColor belongs on the viewport export in this Next version.
export const viewport: Viewport = {
  themeColor: "#08080a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        {/*
          Japanese is loaded at runtime rather than bundled. Noto Sans JP is
          several megabytes across its subsets, and only a fraction of visitors
          read Japanese — the browser fetches just the ranges it needs, and a
          fetch failure degrades to a system CJK font instead of breaking the
          build the way the Latin fonts did.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap"
        />
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
