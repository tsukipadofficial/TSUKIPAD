"use client";

import { useEffect } from "react";
import { rememberReferrer } from "@/lib/referral";

/// Records a `?ref=` the moment someone arrives, before they navigate away.
///
/// Reads location directly rather than useSearchParams so it needs no Suspense
/// boundary, and runs once per mount because first touch wins.
export function ReferralCapture() {
  useEffect(() => {
    rememberReferrer(new URLSearchParams(window.location.search).get("ref"));
  }, []);
  return null;
}
