import Link from "next/link";
import { StockDiscovery } from "~~/components/discover/StockDiscovery";
import { type DiscoveryAsset, discoveryCatalog } from "~~/services/discover/catalog";

export const metadata = {
  title: "Find your stock mood · Basqit",
  description: "Drop an idea. Watch the stocks click. Discover Stock Tokens by theme with Jev.",
};
export const dynamic = "force-dynamic";

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; similar?: string }>;
}) {
  const { theme, similar } = await searchParams;
  let assets: DiscoveryAsset[] | undefined;
  try {
    assets = await discoveryCatalog();
  } catch {
    /* Render a recoverable catalog error below. */
  }
  if (!assets)
    return (
      <main className="bq-dashboard">
        <h1>Stock discovery is taking a break</h1>
        <p>The token catalog could not be loaded.</p>
        <Link href="/discover" className="btn btn-primary">
          Try again
        </Link>
      </main>
    );
  const source = assets.find(asset => asset.symbol === similar);
  return (
    <StockDiscovery
      assets={assets}
      initialTheme={
        source ? `Stocks similar to ${source.symbol}` : typeof theme === "string" ? theme.slice(0, 180) : ""
      }
      similar={source?.symbol}
    />
  );
}
