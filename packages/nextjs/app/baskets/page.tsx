import type { Metadata } from "next";
import { BasketArt } from "~~/components/waitlist/SoonArt";
import { WaitlistForm } from "~~/components/waitlist/WaitlistForm";

export const metadata: Metadata = {
  title: "Baskets",
  description: "Build a basket of Stock Tokens, publish it and earn a fee every time it trades. In development.",
};

export default function BasketsPage() {
  return (
    <main className="bq-dashboard bq-soon">
      <section className="bq-soon-hero">
        <div>
          <p className="bq-soon-status">In development</p>
          <h1>Build a basket. Publish it. Earn a fee.</h1>
          <p className="bq-soon-lead">
            Turn a stock idea into one token anyone can buy. Pick the companies, set how much of each, give it a name
            and the story behind it.
          </p>
          <WaitlistForm product="baskets" cta="Get early access to Baskets" />
        </div>
        <BasketArt />
      </section>
      {/* A real sequence, so it is shown as one: the brand's three verbs in the logo's three bar colours. */}
      <ol className="bq-soon-steps">
        <li>
          <strong>Build</strong>
          Pick the companies and how much of each. Every basket share holds fixed amounts of real Stock Tokens.
        </li>
        <li>
          <strong>Publish</strong>
          Name it, tell the story, share the link. Buyers get the whole idea in one purchase, in their own wallet.
        </li>
        <li>
          <strong>Earn</strong>
          Set a small creator fee on every buy and sell. Buyers see it before they confirm.
        </li>
      </ol>
      <p className="bq-soon-fine">
        Baskets launch on testnet first. Creator fees and pooled shares get a legal review before any public launch.
      </p>
    </main>
  );
}
