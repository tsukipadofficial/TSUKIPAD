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
  const { ready, authenticated } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { setActiveWallet } = useSetActiveWallet();
  const { isConnected } = useAccount();
  const attempted = useRef(false);

  useEffect(() => {
    // walletsReady matters: before it flips, `wallets` is empty for everyone,
    // and acting on that would mint a redundant wallet for people who already
    // connected one.
    if (!ready || !authenticated || !walletsReady) return;
    if (wallets.length > 0 || attempted.current) return;

    attempted.current = true;
    createWallet().catch(() => {
      // Most failures here are "user already has an embedded wallet", which is
      // the desired end state anyway. Allow a retry on genuine errors.
      attempted.current = false;
    });
  }, [ready, authenticated, walletsReady, wallets.length, createWallet]);

  // Having a wallet is not the same as wagmi being connected to it. The
  // waitlist signs through wagmi's useSignMessage, so a freshly minted
  // embedded wallet has to be promoted to the active account or step 02 stays
  // dead for exactly the users this component exists to help.
  useEffect(() => {
    if (!walletsReady || isConnected || wallets.length === 0) return;
    void setActiveWallet(wallets[0]);
  }, [walletsReady, isConnected, wallets, setActiveWallet]);

  return null;
}
