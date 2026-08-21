"use client";

import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { bindReferrer, rememberReferrer } from "@/lib/referral";

/// Records a `?ref=` on arrival, then binds it to the account once signed in.
///
/// The browser copy is only a staging area. A link opened on a phone and a
/// launch made on a laptop are the same person to Privy and two different
/// browsers to localStorage, so the account is what the referral ends up on.
export function ReferralCapture() {
  const { authenticated, getAccessToken } = usePrivy();
  const bound = useRef(false);

  useEffect(() => {
    rememberReferrer(new URLSearchParams(window.location.search).get("ref"));
  }, []);

  useEffect(() => {
    if (!authenticated || bound.current) return;
    bound.current = true;
    void (async () => {
      const token = await getAccessToken();
      if (token) await bindReferrer(token);
    })();
  }, [authenticated, getAccessToken]);

  return null;
}
