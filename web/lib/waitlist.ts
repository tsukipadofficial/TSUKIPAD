/// Waitlist domain rules: what a valid entry is, and how it is keyed.
///
/// Deliberately different from the launchpads that just collect pasted
/// addresses: reaching 100% requires a *signature*, so an address you do not
/// control cannot be farmed onto the board. Signing is free and gasless.

import { verifyMessage, isAddress, getAddress } from "viem";

export const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/; // X's own handle rule

export type Entry = {
  handle: string;      // stored lower-case, no leading @
  display: string;     // as the user typed it, for the board
  address: string | null;
  createdAt: number;
  verifiedAt: number | null;
  /// Set when the account posted about us and we confirmed authorship.
  postedAt: number | null;
  postUrl: string | null;
};

export const K = {
  entry: (h: string) => `wl:h:${h}`,
  addr: (a: string) => `wl:a:${a.toLowerCase()}`,
  board: "wl:board",
  count: "wl:count",
  rate: (ip: string) => `wl:rl:${ip}`,
};

/// Signing this proves control of the wallet and binds it to one handle, so a
/// single signature cannot be replayed onto a different entry.
export function signMessage(handle: string, address: string): string {
  return [
    "TSUKIPAD waitlist",
    "",
    `handle: @${handle}`,
    `address: ${getAddress(address)}`,
    "",
    "Signing proves you control this wallet.",
    "It is not a transaction and costs no gas.",
  ].join("\n");
}

export function normaliseHandle(raw: string): string | null {
  const h = raw.trim().replace(/^@+/, "");
  return HANDLE_RE.test(h) ? h : null;
}

export function normaliseAddress(raw: string): string | null {
  const a = raw.trim();
  return isAddress(a) ? getAddress(a) : null;
}

export async function signatureValid(
  handle: string,
  address: string,
  signature: string,
): Promise<boolean> {
  try {
    return await verifyMessage({
      address: getAddress(address),
      message: signMessage(handle, address),
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

/// 50% for a handle, 100% once a signed wallet is attached -- an incomplete bar
/// is what actually drives people to finish.
export function clearance(e: Pick<Entry, "verifiedAt">): 50 | 100 {
  return e.verifiedAt ? 100 : 50;
}
