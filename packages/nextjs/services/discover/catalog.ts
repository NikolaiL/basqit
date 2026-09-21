import profiles from "./profiles.json";
import { isAddress } from "viem";
import type { RawAsset } from "~~/services/atlas/types";
import { readTokenData } from "~~/services/portfolio/token-data";

export type DiscoveryAsset = {
  symbol: string;
  name: string;
  address: `0x${string}`;
  description: string;
  website: string;
  active: boolean;
};

export async function discoveryCatalog(): Promise<DiscoveryAsset[]> {
  const payload = await readTokenData("assets");
  if (!Array.isArray(payload.assets)) throw new Error("Invalid asset catalog");
  const known = profiles as Record<string, { description: string; website: string }>;
  return payload.assets
    .flatMap((asset: RawAsset) => {
      const address = asset.deployments?.find(d => d.chainId === 4663)?.contractAddress;
      if (
        !address ||
        !isAddress(address) ||
        typeof asset.tokenSymbol !== "string" ||
        typeof asset.tokenName !== "string"
      )
        return [];
      const profile = known[asset.tokenSymbol];
      return [
        {
          symbol: asset.tokenSymbol,
          name: asset.tokenName.replace(/\s*•\s*Robinhood Token$/, ""),
          address: address as `0x${string}`,
          description: profile?.description ?? "",
          website: profile?.website ?? "",
          active: asset.status === "ASSET_STATUS_ACTIVE",
        },
      ];
    })
    .sort((a: DiscoveryAsset, b: DiscoveryAsset) => a.symbol.localeCompare(b.symbol));
}
