import Link from "next/link";
import { AssetCatalog } from "~~/components/atlas/AssetCatalog";
import { readCatalog } from "~~/services/atlas/catalog";

export const metadata = {
  title: "Tokenized Stock Prices on Robinhood Chain",
  description:
    "Every Stock Token on Robinhood Chain with live reference prices, multipliers and trading sessions. Search tokenized stocks and ETFs and buy them onchain.",
  alternates: { canonical: "/atlas" },
};
export const dynamic = "force-dynamic";

export default async function AtlasPage() {
  const { assets, unavailable } = await readCatalog();
  return (
    <div className="bq-dashboard">
      <div className="bq-page-heading">
        <div>
          <h1>Explore assets</h1>
          <p>Stock Tokens on Robinhood Chain. Tap an asset to explore.</p>
        </div>
      </div>
      <section className="bq-events-intro" aria-labelledby="stock-tokens-explained">
        <h2 id="stock-tokens-explained">What is a Stock Token?</h2>
        <p>
          A digital token held in a crypto wallet, linked to a company’s stock or an ETF — a fund that holds a
          collection of investments. Its value can rise or fall with the underlying investment. Holding the token does
          not make you a shareholder or give you voting rights in that company.
        </p>
        <p>
          One token does not always mean one share. A shares-per-token number, called the multiplier, can change after
          events such as dividends or stock splits. Your token balance can stay the same while that number changes.
        </p>
        <Link className="link" href="/corporate-events">
          Understand dividends, stock splits and corporate events →
        </Link>
      </section>
      {unavailable ? (
        <div role="alert" className="bq-empty card">
          <h2>The asset catalog is temporarily unavailable</h2>
          <p>Please reload to try again.</p>
          <Link className="btn bq-secondary" href="/atlas">
            Reload catalog
          </Link>
        </div>
      ) : (
        <AssetCatalog assets={assets} />
      )}
    </div>
  );
}
