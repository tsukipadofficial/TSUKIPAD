/// Verifying that someone actually posted about us.
///
/// The official X API puts tweet lookup behind paid tiers, but the syndication
/// endpoint that powers embedded tweets is public and unauthenticated, and
/// returns the author and full text. That is enough to check two things that
/// matter: the post exists and was written by the handle claiming it.
///
/// This is an undocumented endpoint. It can change without notice, so every
/// failure path is treated as "could not verify" rather than "cheating", and
/// the waitlist never depends on it for a user's place.

const TWEET_URL =
  /^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})/i;

export type PostCheck =
  | { ok: true; author: string; text: string }
  | { ok: false; reason: "bad-url" | "not-found" | "wrong-author" | "no-mention" | "unavailable" };

export function parseTweetUrl(url: string): { author: string; id: string } | null {
  const m = TWEET_URL.exec(url.trim());
  return m ? { author: m[1], id: m[2] } : null;
}

type Syndication = {
  id_str?: string;
  text?: string;
  user?: { screen_name?: string };
};

/// `handle` is the entry claiming the post; `mention` is what the text must
/// contain for the post to count as being about us.
export async function verifyPost(
  url: string,
  handle: string,
  mention: string,
): Promise<PostCheck> {
  const parsed = parseTweetUrl(url);
  if (!parsed) return { ok: false, reason: "bad-url" };

  let data: Syndication;
  try {
    const res = await fetch(
      `https://cdn.syndication.twimg.com/tweet-result?id=${parsed.id}&token=a`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; tsukipad/1.0)" },
        cache: "no-store",
      },
    );
    if (!res.ok) return { ok: false, reason: res.status === 404 ? "not-found" : "unavailable" };
    data = (await res.json()) as Syndication;
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  const author = data.user?.screen_name;
  const text = data.text;
  if (!author || typeof text !== "string") return { ok: false, reason: "not-found" };

  // The author is the claim that matters: it proves the person holds the
  // handle, which typing a handle into a box does not.
  if (author.toLowerCase() !== handle.toLowerCase()) {
    return { ok: false, reason: "wrong-author" };
  }
  if (!text.toLowerCase().includes(mention.toLowerCase())) {
    return { ok: false, reason: "no-mention" };
  }
  return { ok: true, author, text };
}
