import Link from "next/link";
import type { Metadata } from "next";
import { StockLogo } from "~~/components/StockLogo";
import { type DiscoveryAsset, discoveryCatalog } from "~~/services/discover/catalog";

export const metadata: Metadata = {
  title: "Tokenized Stocks on Robinhood Chain: Every Stock Token",
  description:
    "What tokenized stocks are, how Robinhood Chain Stock Tokens work, and the full list of tokenized stocks and ETFs you can buy onchain from your own wallet.",
  alternates: { canonical: "/tokenized-stocks" },
};

// Facts from the issuer's page (robinhood.com/rhj/stocktokens) and docs.robinhood.com/chain.
const faq = [
  {
    q: "What are tokenized stocks?",
    a: "Tokenized stocks are blockchain tokens that track the price of a listed share or ETF. On Robinhood Chain they are called Stock Tokens. You hold them in your own wallet and can move or trade them onchain like any other token.",
  },
  {
    q: "Who issues the Stock Tokens on Robinhood Chain?",
    a: "Stock Tokens are tokenized debt securities issued by Robinhood Assets (Jersey) Limited. Each token is backed 1:1 by the underlying share, held by a licensed custodian.",
  },
  {
    q: "Do tokenized stocks give me shareholder rights?",
    a: "No. Stock Tokens give economic exposure to the underlying security. They do not grant legal or beneficial rights in the company, such as voting.",
  },
  {
    q: "How do dividends work for tokenized stocks?",
    a: "There is no cash payout. When the company pays a dividend, the token's multiplier rises, so each token represents a little more of the underlying share. Your token balance stays the same.",
  },
  {
    q: "Who can hold Stock Tokens?",
    a: "The issuer says Stock Tokens are not available to U.S. persons or to residents of Canada, the United Kingdom and Switzerland. Check the issuer's terms for your country before you buy.",
  },
  {
    q: "How do I buy tokenized stocks on Basqit?",
    a: "Connect a wallet on Robinhood Chain, hold some USDG, then pick a Stock Token in Discover or Assets and swap. The trade settles onchain, straight into your wallet.",
  },
];

export default async function TokenizedStocksPage() {
  const assets: DiscoveryAsset[] = await discoveryCatalog().catch(() => []);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
  return (
    <main className="bq-dashboard bq-guide">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="bq-page-heading">
        <div>
          <h1>Tokenized stocks on Robinhood Chain</h1>
          <p>
            Stock Tokens are tokenized stocks and ETFs on Robinhood Chain, an Ethereum layer 2.
            {assets.length ? ` Basqit lists all ${assets.length} of them. ` : " "}
            Find them by mood, check the onchain details, and buy from your own wallet.
          </p>
        </div>
        <div className="bq-heading-actions">
          <Link className="btn btn-primary" href="/discover">
            Find your stock mood
          </Link>
        </div>
      </div>

      <section>
        <h2>How tokenized stocks work on Robinhood Chain</h2>
        <ul>
          <li>
            Each Stock Token is an ERC-20 token on Robinhood Chain (chain ID 4663), backed 1:1 by the underlying share.
          </li>
          <li>
            Stock Tokens are tokenized debt securities issued by Robinhood Assets (Jersey) Limited, not equity in the
            company.
          </li>
          <li>Dividends and splits update a multiplier (ERC-8056) instead of changing your balance.</li>
          <li>Prices are quoted in USDG. Basqit routes trades through Uniswap pools onchain.</li>
        </ul>
      </section>

      {assets.length > 0 && (
        <section>
          <h2>All tokenized stocks and ETFs</h2>
          <ul className="bq-guide-grid">
            {assets.map(asset => (
              <li key={asset.symbol}>
                <Link href={`/tokenized-stocks/${asset.symbol.toLowerCase()}`}>
                  <StockLogo symbol={asset.symbol} size={28} />
                  <strong>{asset.symbol}</strong>
                  <span>{asset.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Tokenized stocks FAQ</h2>
        {faq.map(({ q, a }) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>

      <p className="bq-soon-fine">
        Basqit is an early preview and is not affiliated with or endorsed by Robinhood. Nothing here is personalized
        financial advice. Stock Tokens carry substantial risk and can lose value.
      </p>
    </main>
  );
}
