/// Turning a social identity into the hash a launch commits to.
///
/// The chain stores only this hash. Publishing the handle itself would put a
/// name on-chain that the person never agreed to; a hash still lets anyone
/// verify an earmark after the fact, once the handle is known.
///
/// Normalisation has to be exact and shared by both sides. The form that
/// creates the commitment and the service that later attests against it must
/// agree byte for byte, or a legitimate recipient can never claim.

import { keccak256, toHex } from "viem";

export const PROVIDERS = ["x", "github", "discord", "telegram"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const PROVIDER_LABEL: Record<Provider, string> = {
  x: "X",
  github: "GitHub",
  discord: "Discord",
  telegram: "Telegram",
};

/// Telegram is offered only once it is a sign-in method, because claiming an
/// earmark means signing in with that account. Switching it on in the site
/// before Privy has Telegram credentials would break sign-in for everyone, so
/// it waits behind NEXT_PUBLIC_PRIVY_TELEGRAM. The server accepts all four
/// regardless: it only ever verifies an account Privy already linked.
export const TELEGRAM_ENABLED = process.env.NEXT_PUBLIC_PRIVY_TELEGRAM === "1";
export const OFFERED_PROVIDERS: readonly Provider[] = PROVIDERS.filter(
  (p) => p !== "telegram" || TELEGRAM_ENABLED,
);

/// X caps handles at 15 characters; GitHub allows 39; Discord usernames 32;
/// Telegram usernames are 5 to 32.
const LIMITS: Record<Provider, number> = { x: 15, github: 39, discord: 32, telegram: 32 };
const SHAPE: Record<Provider, RegExp> = {
  x: /^[A-Za-z0-9_]+$/,
  github: /^[A-Za-z0-9-]+$/,
  discord: /^[A-Za-z0-9._]+$/,
  telegram: /^[A-Za-z0-9_]{5,}$/,
};

/// Lower-cased and stripped of a leading @, because "@Alice" and "alice" are the
/// same account and must not produce different commitments.
export function normaliseHandle(provider: Provider, raw: string): string | null {
  const h = raw.trim().replace(/^@+/, "");
  if (h.length === 0 || h.length > LIMITS[provider]) return null;
  if (!SHAPE[provider].test(h)) return null;
  return h.toLowerCase();
}

/// The committed value: `provider:handle`, hashed.
export function commitmentFor(provider: Provider, raw: string): `0x${string}` | null {
  const h = normaliseHandle(provider, raw);
  return h ? keccak256(toHex(`${provider}:${h}`)) : null;
}

/// Display form, for showing an earmark next to a launch.
export function labelFor(provider: Provider, raw: string): string {
  const h = normaliseHandle(provider, raw) ?? raw.trim();
  if (provider === "github") return `github.com/${h}`;
  if (provider === "telegram") return `t.me/${h}`;
  return `@${h}`;
}
