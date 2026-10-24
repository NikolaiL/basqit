import type { Metadata } from "next";
import { Packs2 } from "~~/components/packs2/Packs2";

export const metadata: Metadata = {
  title: "Packs",
  description: "Experimental Packs with drand randomness, repeatable outcomes and separate payouts. Test tokens only.",
  robots: { index: false, follow: false },
};

export default function PacksPage() {
  return <Packs2 />;
}
