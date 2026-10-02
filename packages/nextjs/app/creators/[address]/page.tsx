import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isAddress } from "viem";
import { CreatorProfile } from "~~/components/creators/CreatorProfile";

export const metadata: Metadata = { title: "Creator", description: "A basket creator on Basqit." };

export default async function CreatorPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  return (
    <main className="bq-dashboard bq-details">
      <CreatorProfile address={address} />
    </main>
  );
}
