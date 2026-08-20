/// Token metadata is stored fully on-chain as a data URI.
///
/// A launchpad normally pins JSON to IPFS, which means running a pinning service
/// and hoping it stays up. Launch metadata is small — a description, an image
/// link, a couple of socials — so encoding it directly into the token contract
/// keeps the token self-contained with nothing external to rot.

export type TokenMetadata = {
  description?: string;
  image?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
  /// Who the creator says the redirected fees fund — an X handle, a GitHub repo
  /// or a URL. Purely a claim: no on-chain link exists between a social account
  /// and a wallet, so the UI always shows the real recipient address beside it.
  fundsLabel?: string;
};

const PREFIX = "data:application/json;base64,";

export function encodeMetadata(meta: TokenMetadata): string {
  const clean = Object.fromEntries(
    Object.entries(meta).filter(([, v]) => typeof v === "string" && v.trim() !== ""),
  );
  if (Object.keys(clean).length === 0) return "";
  const json = JSON.stringify(clean);
  const base64 =
    typeof window === "undefined"
      ? Buffer.from(json, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(json)));
  return PREFIX + base64;
}

export function decodeMetadata(uri: string): TokenMetadata {
  if (!uri) return {};
  try {
    if (uri.startsWith(PREFIX)) {
      const base64 = uri.slice(PREFIX.length);
      const json =
        typeof window === "undefined"
          ? Buffer.from(base64, "base64").toString("utf8")
          : decodeURIComponent(escape(atob(base64)));
      return JSON.parse(json) as TokenMetadata;
    }
    // Plain http(s)/ipfs URIs are treated as a bare image reference.
    return { image: uri };
  } catch {
    return {};
  }
}

/// Only render images we can actually load, and never let a token inject a
/// javascript: or data:text/html URL into an <img> src.
export function safeImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${trimmed.slice("ipfs://".length)}`;
  }
  if (trimmed.startsWith("data:image/")) return trimmed;
  return undefined;
}

/// Resolve a claimed beneficiary label to a link, if it looks like one we
/// recognise. Anything unrecognised is rendered as plain text, never linked.
export function beneficiaryLink(label: string | undefined): { text: string; href?: string } | null {
  if (!label) return null;
  const t = label.trim();
  if (!t) return null;

  if (/^@[A-Za-z0-9_]{1,15}$/.test(t)) {
    return { text: t, href: `https://x.com/${t.slice(1)}` };
  }
  if (/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(t)) {
    return { text: t, href: `https://github.com/${t}` };
  }
  if (t.startsWith("https://github.com/") || t.startsWith("https://x.com/")) {
    return { text: t.replace(/^https:\/\//, ""), href: t };
  }
  if (t.startsWith("https://")) {
    return { text: t.replace(/^https:\/\//, ""), href: t };
  }
  return { text: t };
}

/// Normalise the many ways people write a Telegram handle into a link.
export function telegramUrl(handle: string): string {
  const t = handle.trim().replace(/^@/, "");
  if (t.startsWith("https://")) return t;
  if (t.startsWith("t.me/")) return `https://${t}`;
  return `https://t.me/${t}`;
}
