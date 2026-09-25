import type { Metadata } from "next";
import { PackArt } from "~~/components/waitlist/SoonArt";
import { WaitlistForm } from "~~/components/waitlist/WaitlistForm";

export const metadata: Metadata = {
  title: "Packs",
  description: "Open a pack of real Stock Tokens for a small fixed price. In design; not on sale.",
};

export default function PacksPage() {
  return (
    <main className="bq-dashboard bq-soon">
      <section className="bq-soon-hero">
        <div>
          <p className="bq-soon-status">In design</p>
          <h1>Open a pack. Pull real shares.</h1>
          <p className="bq-soon-lead">
            One small, fixed price. Real Stock Tokens inside, straight to your wallet. Two kinds of pack are in design.
          </p>
          <WaitlistForm product="packs" cta="Hear first when Packs open" confetti={["MSFT", "GOOGL", "RKLB"]} />
        </div>
        <PackArt />
      </section>
      {/* Each description wears its pack's colour from the art above, so text and picture read as a pair. */}
      <ul className="bq-soon-pack-notes">
        <li className="is-gift">
          <strong>Gift Pack</strong>
          <em>Value matches the price</em>
          Stock Tokens worth what you paid, picked for you. Open it to see which companies are inside, or send it to
          someone.
        </li>
        <li className="is-surprise">
          <strong>Surprise Pack</strong>
          <em>Value varies, a few cents in</em>A random mix of Stock Tokens. Every token in a round is set aside before
          the first pack sells, and one public seed sets the whole round. Some packs are worth less than you paid.
        </li>
      </ul>
      <p className="bq-soon-fine">
        Nothing here is on sale. Packs need a legal review first, and Surprise Packs will not ship until that review is
        done.
      </p>
    </main>
  );
}
