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

/// The link a referrer shares.
export function referralLink(origin: string, address: string): string {
  return `${origin}/?ref=${getAddress(address)}`;
}
