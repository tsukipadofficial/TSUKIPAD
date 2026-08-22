"use client";

import { useEffect, useRef } from "react";
import { usePrivy, useWallets, useCreateWallet } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useAccount } from "wagmi";

/// Guarantees every signed-in user ends up with a wallet.
///
/// Privy can mint one automatically on login, but that is a dashboard setting
/// this app does not control at build time -- and when it is off, anyone who
/// signs in with email or a social account gets no wallet at all, so there is
/// nothing for them to sign with. Creating one explicitly makes the behaviour
/// independent of that setting.
export function EnsureEmbeddedWallet() {
  const { ready, authenticated, user } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { setActiveWallet } = useSetActiveWallet();
  const { isConnected } = useAccount();
  const attempted = useRef(false);

  // Privy calls its own wallets "privy"; anything else is a browser extension
  // or a mobile wallet the visitor already had.
  const embedded = wallets.find((w) => w.walletClientType === "privy");

  useEffect(() => {
    // walletsReady matters: before it flips, `wallets` is empty for everyone.
    if (!ready || !authenticated || !walletsReady) return;
    // The test is whether an *embedded* wallet exists, not whether any wallet
    // does. Having MetaMask installed is not the same as having signed in with
    // it, and treating it as one meant somebody who signed in with X never got
    // a wallet of their own.
    if (embedded || attempted.current) return;

    attempted.current = true;
    createWallet().catch(() => {
      // Most failures here are "user already has an embedded wallet", which is
      // the desired end state anyway. Allow a retry on genuine errors.
      attempted.current = false;
    });
  }, [ready, authenticated, walletsReady, embedded, createWallet]);

  // Having a wallet is not the same as wagmi being connected to it. The
  // waitlist signs through wagmi's useSignMessage, so a wallet has to be
  // promoted to the active account or signing stays dead.
  //
  // Which wallet matters. Picking the first one activated whichever extension
  // happened to be installed -- so signing in with X opened a MetaMask connect
  // prompt and left the account showing a MetaMask address. Privy's own
  // `user.wallet` is the account's wallet; the embedded one is the fallback,
  // and an unrelated extension is never promoted on its own.
  useEffect(() => {
    if (!walletsReady || isConnected || wallets.length === 0) return;

    const primary = user?.wallet?.address?.toLowerCase();
    const target =
      (primary && wallets.find((w) => w.address.toLowerCase() === primary)) ||
      embedded;
    if (!target) return;

    void setActiveWallet(target);
  }, [walletsReady, isConnected, wallets, embedded, user, setActiveWallet]);

  return null;
}
