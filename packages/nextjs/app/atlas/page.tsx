import Link from "next/link";
import { isAddress } from "viem";
import { AssetCatalog, type CatalogAsset } from "~~/components/atlas/AssetCatalog";
import type { RawAsset } from "~~/services/atlas/types";
import { decimalPattern } from "~~/services/portfolio/format";

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
