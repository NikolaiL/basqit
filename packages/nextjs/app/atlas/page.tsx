import Link from "next/link";
import { isAddress, parseUnits } from "viem";
import { AssetCatalog, type CatalogAsset } from "~~/components/atlas/AssetCatalog";
import type { RawAsset } from "~~/services/atlas/types";
import { decimalPattern, tokenValue } from "~~/services/portfolio/format";

export const metadata = { title: "Explore assets" };
export const dynamic = "force-dynamic";

export default async function AtlasPage() {
  let assets: CatalogAsset[] = [];
  let unavailable = false;
  try {
    const response = await fetch("https://api.robinhood.com/rhj/assets", {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("Asset catalog unavailable");
    const payload = await response.json();
    if (!Array.isArray(payload.assets)) throw new Error("Invalid catalog");
    assets = payload.assets.flatMap((asset: RawAsset) => {
      if (!asset || typeof asset.tokenSymbol !== "string" || typeof asset.tokenName !== "string") return [];
      const deployment = Array.isArray(asset.deployments)
        ? asset.deployments.find(d => d?.chainId === 4663)
        : undefined;
      if (!deployment || typeof deployment.contractAddress !== "string" || !isAddress(deployment.contractAddress))
        return [];
      return [
        {
          symbol: asset.tokenSymbol,
          name: asset.tokenName.replace(/\s*•\s*Robinhood Token$/, ""),
          address: deployment.contractAddress as `0x${string}`,
          multiplier:
            typeof asset.currentMultiplier === "string" && decimalPattern.test(asset.currentMultiplier)
              ? asset.currentMultiplier
              : null,
          decimals:
            Number.isInteger(asset.tokenDecimals) && asset.tokenDecimals >= 0 && asset.tokenDecimals <= 255
              ? asset.tokenDecimals
              : null,
          isin: typeof asset.isin === "string" ? asset.isin : null,
          status:
            asset.status === "ASSET_STATUS_ACTIVE"
              ? "Active"
              : asset.status === "ASSET_STATUS_INACTIVE"
                ? "Inactive"
                : "Unknown",
        },
      ];
    });
    assets.sort((a, b) => a.symbol.localeCompare(b.symbol));
  } catch {
    unavailable = true;
  }
  // The catalog needs every quote: one cached bulk request avoids per-card requests.
  if (assets.length) {
    try {
      const response = await fetch("https://api.robinhood.com/rhj/prices", {
        next: { revalidate: 15 },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error("Prices unavailable");
      const payload = await response.json();
      if (!Array.isArray(payload.quotes)) throw new Error("Invalid quotes");
      for (const asset of assets) {
        const quote = payload.quotes.find(
          (q: {
            tokenSymbol?: string;
            currency?: string;
            deployments?: { chainId?: number; contractAddress?: string }[];
          }) =>
            q?.tokenSymbol === asset.symbol &&
            q.currency === "USD" &&
            Array.isArray(q.deployments) &&
            q.deployments.some(
              d =>
                d?.chainId === 4663 &&
                typeof d.contractAddress === "string" &&
                d.contractAddress.toLowerCase() === asset.address.toLowerCase(),
            ),
        );
        if (
          !quote ||
          !asset.multiplier ||
          typeof quote.bid !== "string" ||
          typeof quote.ask !== "string" ||
          typeof quote.generatedAt !== "string" ||
          !Number.isFinite(Date.parse(quote.generatedAt))
        )
          continue;
        asset.price = tokenValue(10n ** 18n, 18, parseUnits(asset.multiplier, 18), quote.bid, quote.ask);
        asset.priceAt = quote.generatedAt;
      }
    } catch {
      /* A price outage must not hide the token catalog. */
    }
  }
  return (
    <div className="bq-dashboard">
      <div className="bq-page-heading">
        <div>
          <div className="bq-eyebrow">THE STOCK TOKEN CATALOG</div>
          <h1>Explore assets</h1>
          <p>Find a token, understand its share equivalent and verify its contract.</p>
        </div>
        <span className="badge badge-outline">Robinhood Chain</span>
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
