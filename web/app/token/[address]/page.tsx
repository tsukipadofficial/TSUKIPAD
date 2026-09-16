import type { Address } from "viem";
import { isAddress } from "viem";
import { notFound } from "next/navigation";
import { TokenRouter } from "@/components/TokenRouter";

export default async function TokenPage({ params }: PageProps<"/token/[address]">) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  return <TokenRouter token={address as Address} />;
}
