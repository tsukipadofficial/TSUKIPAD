/// Carrying a referral from a link through to a launch.
///
/// The link only ever puts the referrer in this browser. That is enough to be
/// useful and not enough to be reliable: click on a phone, launch on a desktop,
/// and the referral is gone. Binding it to the account at sign-up -- which is
/// possible now that everyone has one -- is the durable version, and this is
/// the piece that feeds it.

import { isAddress, getAddress, zeroAddress } from "viem";
import { STORAGE_PREFIX } from "./brand";

const KEY = `${STORAGE_PREFIX}:ref`;

export const EMPTY_COMMITMENT =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

/// Record a referrer seen in `?ref=`. First touch wins: whoever actually found
/// this person keeps the credit, rather than whoever they clicked most recently.
export function rememberReferrer(raw: string | null): void {
  if (!raw || typeof window === "undefined") return;
  if (!isAddress(raw)) return;
  if (localStorage.getItem(KEY)) return;
  localStorage.setItem(KEY, getAddress(raw));
}

export function storedReferrer(): `0x${string}` {
  if (typeof window === "undefined") return zeroAddress;
  const v = localStorage.getItem(KEY);
  return v && isAddress(v) ? getAddress(v) : zeroAddress;
}

/// Push a browser-held referrer up to the account, so it survives the device.
/// Safe to call on every sign-in: the server keeps the first one it was given.
export async function bindReferrer(accessToken: string): Promise<void> {
  const referrer = storedReferrer();
  if (referrer === zeroAddress) return;
  try {
    await fetch("/api/referral", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken, referrer }),
    });
  } catch {
    /* the browser copy is still there; nothing is lost by a failed sync */
  }
}

/// The referrer bound to the signed-in account, falling back to this browser.
/// The account is authoritative -- it is the copy that survives a new device.
export async function accountReferrer(accessToken: string | null): Promise<`0x${string}`> {
  if (accessToken) {
    try {
      const r = await fetch("/api/referral", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const j = await r.json();
      if (j.ok && j.referrer && isAddress(j.referrer)) return getAddress(j.referrer);
    } catch {
      /* fall through to the browser copy */
    }
  }
  return storedReferrer();
}

/// The link a referrer shares.
export function referralLink(origin: string, address: string): string {
  return `${origin}/?ref=${getAddress(address)}`;
}
