import type { Metadata } from "next";
import { SealedGifts } from "~~/components/packs/SealedGifts";
import { TestnetDemo } from "~~/components/packs/TestnetDemo";
import { GiftArt } from "~~/components/waitlist/OpenedArt";
import { WaitlistForm } from "~~/components/waitlist/WaitlistForm";

export const metadata: Metadata = {
  title: "Gifts",
  description: "Send someone real Stock Tokens in a sealed gift with fixed contents. In design; not on sale.",
};

export default function GiftsPage() {
  return (
    <main className="bq-dashboard bq-soon">
      <SealedGifts />
      <section className="bq-soon-hero">
        <div>
          <p className="bq-soon-status">In design · testnet demo below</p>
          <h1>Send someone Stock Tokens.</h1>
          <p className="bq-soon-lead">
            A sealed gift of Stock Tokens, worth what you paid when you bought it. They see which companies are inside
            when they open it. The demo below uses test tokens with no value.
          </p>
          <WaitlistForm product="gifts" cta="Hear first when Gifts open" confetti={["MSFT", "GOOGL", "AAPL"]} />
        </div>
        <GiftArt />
      </section>
      <ol className="bq-soon-steps">
        <li>
          <strong>Pick</strong>
          Choose a gift with a set mix of companies. Every company and amount is shown before you pay.
        </li>
        <li>
          <strong>Send</strong>
          Send it to a friend&apos;s wallet, or keep it. It stays sealed until someone opens it.
        </li>
        <li>
          <strong>Open</strong>
          The Stock Tokens go straight to the holder&apos;s wallet. From then on their value moves with the market.
        </li>
      </ol>
      <TestnetDemo kind="gifts" />
      <p className="bq-soon-fine">
        Nothing here is on sale. Gifts launch on testnet first and get a legal review before any public launch.
      </p>
    </main>
  );
}
