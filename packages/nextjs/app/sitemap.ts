import type { MetadataRoute } from "next";
import { discoveryCatalog } from "~~/services/discover/catalog";
import { baseUrl } from "~~/utils/scaffold-eth/getMetadata";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages = ["/discover", "/tokenized-stocks", "/atlas", "/corporate-events", "/baskets", "/gifts", "/packs"];
  // A catalog outage must not take the sitemap down with it.
  const symbols = await discoveryCatalog().then(
    assets => assets.map(asset => asset.symbol),
    () => [] as string[],
  );
  return [
    ...pages.map(path => ({ url: `${baseUrl}${path}`, changeFrequency: "daily" as const })),
    ...symbols.map(symbol => ({
      url: `${baseUrl}/tokenized-stocks/${symbol.toLowerCase()}`,
      changeFrequency: "daily" as const,
    })),
  ];
}
