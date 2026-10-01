import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { isAddress } from "viem";
import { BasketDetails } from "~~/components/baskets/BasketDetails";

export const metadata: Metadata = { title: "Basket", description: "A Basqit basket on Robinhood Chain testnet." };

export default async function BasketPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  return (
    <main className="bq-dashboard bq-details">
      <BasketDetails basket={address} />
    </main>
  );
}
