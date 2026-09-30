import type { Metadata } from "next";
import { TestnetDemo } from "~~/components/packs/TestnetDemo";
import { PackArt } from "~~/components/waitlist/OpenedArt";
import { WaitlistForm } from "~~/components/waitlist/WaitlistForm";

export const metadata: Metadata = {
  title: "Packs",
  description: "Packs of Stock Tokens for a small fixed price. In design; testnet demo only, not on sale.",
};

export default function PacksPage() {
  return (
    <main className="bq-dashboard bq-soon">
      <section className="bq-soon-hero">
        <div>
          <p className="bq-soon-status">In design · testnet demo below</p>
          <h1>Explore a pack of Stock Tokens.</h1>
          <p className="bq-soon-lead">
            One small, fixed price. A random mix of Stock Tokens inside, straight to your wallet. Some packs are worth
            less than you paid. The demo below uses test tokens with no value; public availability remains subject to
            review.
          </p>
          <WaitlistForm product="packs" cta="Hear first when Packs open" confetti={["RKLB", "NVDA", "TSLA"]} />
        </div>
        <PackArt />
      </section>
      <ol className="bq-soon-steps">
        <li>
          <strong>Buy</strong>
          Buy a pack in a round. Every prize in the round is set aside before the first pack sells.
        </li>
        <li>
          <strong>Draw</strong>
          When the round sells out, one random seed from Dice Protocol shuffles the prizes, one per pack.
        </li>
        <li>
          <strong>Open</strong>
          See what you pulled and claim it to your wallet. Anyone can check the shuffle from the seed.
        </li>
      </ol>
      <TestnetDemo kind="packs" />
      <p className="bq-soon-fine">Nothing here is on sale. Packs will not ship until a legal review is done.</p>
    </main>
  );
}
