import type { Address } from "viem";
import { isAddress } from "viem";
import { notFound } from "next/navigation";
import { TokenView } from "@/components/TokenView";

export default async function TokenPage({ params }: PageProps<"/token/[address]">) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  return <TokenView token={address as Address} />;
}
