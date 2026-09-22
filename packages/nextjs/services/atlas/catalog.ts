import { isAddress, parseUnits } from "viem";
import type { CatalogAsset } from "~~/components/atlas/AssetCatalog";
import { tradingSessions } from "~~/services/atlas/tradingSessions";
import type { RawAsset } from "~~/services/atlas/types";
import { decimalPattern, tokenValue } from "~~/services/portfolio/format";
import { readTokenData } from "~~/services/portfolio/token-data";

export async function readCatalog() {
  let assets: CatalogAsset[] = [];
  let unavailable = false;
  try {
    const payload = await readTokenData("assets");
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
          sessions: tradingSessions(asset.tradingCapabilities),
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
      const payload = await readTokenData("prices");
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
  return { assets, unavailable };
}
