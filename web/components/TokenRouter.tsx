"use client";

import type { Address } from "viem";
import { useReadContract } from "wagmi";

import { TokenView } from "./TokenView";
import { CurveTokenView } from "./CurveTokenView";
import { Skeleton } from "./ui";
import { curveAbi } from "@/lib/abi";
import { CURVE_ADDRESS, isCurveDeployed } from "@/lib/config";

/// One URL for both kinds of launch. Asks the curve whether it knows the token
/// and hands off to the matching page; a direct launch is the default so that
/// every existing link keeps working with the curve undeployed.
export function TokenRouter({ token }: { token: Address }) {
  const { data: isCurve, isLoading } = useReadContract({
    address: CURVE_ADDRESS,
    abi: curveAbi,
    functionName: "isCurve",
    args: [token],
    query: { enabled: isCurveDeployed, staleTime: Infinity },
  });

  if (isCurveDeployed && isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-8">
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Skeleton className="h-96 border-2 border-line" />
          <Skeleton className="h-96 border-2 border-line" />
        </div>
      </div>
    );
  }

  return isCurve ? <CurveTokenView token={token} /> : <TokenView token={token} />;
}
