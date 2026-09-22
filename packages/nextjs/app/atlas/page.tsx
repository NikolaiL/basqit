import Link from "next/link";
import { AssetCatalog } from "~~/components/atlas/AssetCatalog";
import { readCatalog } from "~~/services/atlas/catalog";

export const metadata = { title: "Explore assets" };
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
