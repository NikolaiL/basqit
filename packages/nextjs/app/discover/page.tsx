import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { StockDiscovery } from "~~/components/discover/StockDiscovery";
import { type DiscoveryAsset, discoveryCatalog } from "~~/services/discover/catalog";
import { shareLayout, shareOrigin, shareSelection } from "~~/services/discover/share";
import { miniappEmbed } from "~~/services/farcaster";

type Search = { theme?: string; similar?: string; stocks?: string; layout?: string };
export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const params = await searchParams;
  const requestHeaders = await headers();
  const origin = shareOrigin(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  );
  const { theme, symbols } = shareSelection(params.theme, params.stocks);
  const title = theme ? `${theme} · My stock mood` : "Find your stock mood";
  const description = symbols.length
    ? `${symbols.join(" · ")}. Explore this stock selection and find your own mood with Basqit.`
    : "Turn an idea into a stock selection. What’s your stock mood?";
  const query = new URLSearchParams({
    theme,
    stocks: symbols.join(","),
    layout: String(shareLayout(params.layout, theme)),
  });
  const image = { url: `${origin}/discover/og?v=6&${query}`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [image] },
    other: { "fc:miniapp": miniappEmbed(origin, `/discover/og/farcaster?v=3&${query}`) },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
export const dynamic = "force-dynamic";

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { theme, similar, stocks } = await searchParams;
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
      sharedSymbols={shareSelection(theme, stocks).symbols}
      initialTheme={
        source ? `Stocks similar to ${source.symbol}` : typeof theme === "string" ? theme.slice(0, 180) : ""
      }
      similar={source?.symbol}
    />
  );
}
