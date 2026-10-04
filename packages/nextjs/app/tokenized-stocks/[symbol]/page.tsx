import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import { StockLogo } from "~~/components/StockLogo";
import { readCatalog } from "~~/services/atlas/catalog";
import { robinhoodChain } from "~~/services/atlas/client";
import { discoveryCatalog } from "~~/services/discover/catalog";
import { money } from "~~/services/portfolio/format";
import { baseUrl } from "~~/utils/scaffold-eth/getMetadata";

type Params = { params: Promise<{ symbol: string }> };

async function findProfile(symbol: string) {
  const assets = await discoveryCatalog();
  return { assets, profile: assets.find(asset => asset.symbol.toLowerCase() === symbol.toLowerCase()) };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { symbol } = await params;
  const { profile } = await findProfile(symbol).catch(() => ({ profile: undefined }));
  if (!profile) return { title: "Stock Token not found", robots: { index: false } };
  const title = `${profile.symbol} Stock Token: Tokenized ${profile.name} on Robinhood Chain`;
  const description = `${profile.name} (${profile.symbol}) as a tokenized stock on Robinhood Chain: contract address, reference price, multiplier, trading sessions, and how to buy ${profile.symbol} onchain.`;
  // Reuses the Discover share card, which already renders stock logos.
  const query = new URLSearchParams({
    theme: `${profile.symbol} tokenized stock`,
    stocks: profile.symbol,
    layout: "0",
  });
  const image = { url: `/discover/og?v=7&${query}`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    alternates: { canonical: `/tokenized-stocks/${profile.symbol.toLowerCase()}` },
    openGraph: { title, description, type: "website", images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function StockTokenPage({ params }: Params) {
  const { symbol } = await params;
  const [{ assets, profile }, { assets: details }] = await Promise.all([findProfile(symbol), readCatalog()]);
  if (!profile) notFound();
  if (symbol !== profile.symbol.toLowerCase()) permanentRedirect(`/tokenized-stocks/${profile.symbol.toLowerCase()}`);
  const detail = details.find(asset => asset.symbol === profile.symbol);
  const index = assets.indexOf(profile);
  // Neighbours in the alphabetical catalog: a cheap, stable set of internal links.
  const related = [...assets.slice(index + 1), ...assets.slice(0, index)].slice(0, 8);
  const explorer = `${robinhoodChain.blockExplorers.default.url}/token/${profile.address}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Tokenized stocks", item: `${baseUrl}/tokenized-stocks` },
      { "@type": "ListItem", position: 2, name: `${profile.symbol} Stock Token` },
    ],
  };
  return (
    <main className="bq-dashboard bq-guide">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <nav aria-label="Breadcrumb" className="bq-guide-crumbs">
        <Link href="/tokenized-stocks">Tokenized stocks</Link> / {profile.symbol}
      </nav>
      <div className="bq-page-heading">
        <div>
          <h1>
            <StockLogo symbol={profile.symbol} size={40} /> {profile.symbol} tokenized stock on Robinhood Chain
          </h1>
          <p>
            {profile.name} Stock Token. {profile.description}
          </p>
        </div>
        <div className="bq-heading-actions">
          <Link className="btn btn-primary" href="/atlas">
            Buy {profile.symbol}
          </Link>
          <Link className="btn bq-secondary" href={`/discover?similar=${profile.symbol}`}>
            Similar stocks
          </Link>
        </div>
      </div>

      <section>
        <h2>{profile.symbol} Stock Token details</h2>
        <dl className="bq-guide-facts">
          <dt>Token</dt>
          <dd>
            {profile.name} Stock Token ({profile.symbol})
          </dd>
          <dt>Contract address</dt>
          <dd>
            <a href={explorer} target="_blank" rel="noopener noreferrer">
              <code>{profile.address}</code>
            </a>
          </dd>
          <dt>Network</dt>
          <dd>Robinhood Chain (chain ID {robinhoodChain.id})</dd>
          {detail?.price && (
            <>
              <dt>Reference price per token</dt>
              <dd>
                {money(detail.price)} USD
                {detail.priceAt && ` as of ${new Date(detail.priceAt).toUTCString()}`}
              </dd>
            </>
          )}
          {detail?.multiplier && (
            <>
              <dt>Shares per token (multiplier)</dt>
              <dd>{detail.multiplier}</dd>
            </>
          )}
          {detail?.isin && (
            <>
              <dt>Underlying ISIN</dt>
              <dd>{detail.isin}</dd>
            </>
          )}
          <dt>Status</dt>
          <dd>{profile.active ? "Active" : "Inactive"}</dd>
          {profile.website && (
            <>
              <dt>Company website</dt>
              <dd>
                <a href={profile.website} target="_blank" rel="noopener noreferrer nofollow">
                  {new URL(profile.website).hostname}
                </a>
              </dd>
            </>
          )}
        </dl>
      </section>

      {detail && (
        <section>
          <h2>When {profile.symbol} trades</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Whole shares</th>
                <th>Fractional</th>
              </tr>
            </thead>
            <tbody>
              {detail.sessions.map(session => (
                <tr key={session.label}>
                  <td>{session.label}</td>
                  <td>{session.whole}</td>
                  <td>{session.fractional}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2>How to buy {profile.symbol} on Robinhood Chain</h2>
        <ol>
          <li>Connect a wallet on Robinhood Chain and hold some USDG.</li>
          <li>
            Open <Link href="/atlas">Assets</Link>, find {profile.symbol} and choose Buy.
          </li>
          <li>Confirm the swap. The {profile.symbol} Stock Token lands in your own wallet.</li>
        </ol>
        <p>
          Stock Tokens are tokenized debt securities issued by Robinhood Assets (Jersey) Limited. They give economic
          exposure to {profile.name} but no shareholder rights, and are not available to U.S. persons or residents of
          Canada, the UK and Switzerland. <Link href="/tokenized-stocks">How tokenized stocks work</Link>.
        </p>
      </section>

      <section>
        <h2>More tokenized stocks</h2>
        <ul className="bq-guide-grid">
          {related.map(asset => (
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

      <p className="bq-soon-fine">
        Basqit is an early preview and is not affiliated with or endorsed by Robinhood. Prices are for reference only.
        Nothing here is personalized financial advice.
      </p>
    </main>
  );
}
