/**
 * Shape of the Stock Token universe and its published price feeds.
 *
 * Two independent sources are joined by ticker:
 *  - the issuer's asset listing, which knows about all listed tokens
 *  - Chainlink's reference data directory, which knows about published feeds
 *
 * Neither is sufficient alone: the asset listing carries no feed addresses, and the
 * feed directory covers only a fraction of the listed tokens.
 */

/** One entry from the issuer's asset listing. */
export type RawAsset = {
  id: string;
  tokenSymbol: string;
  tokenName: string;
  deployments: { contractAddress: string; chainId: number; networkName: string }[];
  currentMultiplier: string;
  pendingMultiplier: string;
  status: string;
  isin?: string;
  tokenDecimals: number;
  logoUrl?: string;
  tradingCapabilities?: Record<string, { whole?: string; fractional?: string }>;
};

/** One entry from the Chainlink reference data directory. */
export type RawFeed = {
  name: string;
  proxyAddress: string;
  secondaryProxyAddress?: string;
  contractAddress: string;
  decimals: number;
  heartbeat: number;
  threshold: number;
  multiply?: string;
  feedType?: string;
  docs?: { marketHours?: string; baseAssetEntityId?: string; quoteAssetEntityId?: string };
};

/** A published price feed, reduced to the fields the map uses. */
export type FeedRef = {
  name: string;
  address: string;
  decimals: number;
  /** Published heartbeat, in seconds. */
  heartbeat: number;
  threshold: number;
  marketHours: string | null;
  feedType: string | null;
  /** True when the entry does not follow the `TICKER / USD` naming convention. */
  nameIsNonStandard: boolean;
};

/** A non-empty AMM pool found for a token. */
export type PoolRef = {
  /** Number of non-empty v3 pools found by the scan. */
  v3Pools: number;
  quotes: string[];
  /** Depth of the deepest pool — a spot ratio from a near-empty pool is not a price. */
  depth: "deep" | "moderate" | "thin" | "dust";
};

/**
 * Where a token's price can come from.
 *
 * These are not equivalent. A feed is an official, auditable reference that goes dark for 52–81
 * hours every weekend. A pool is live around the clock but is only as good as its depth, and its
 * price is derived rather than published.
 */
export type PriceSource = "feed" | "pool" | "both" | "none";

/** A single joined row: one listed token, plus whatever is known about its feed. */
export type UniverseRow = {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  /** Multiplier exactly as published, 1e18-scaled. */
  multiplier: string;
  /** The same multiplier as a number, for display and comparison. */
  multiplierValue: number;
  /** A queued multiplier change. Empty when nothing is pending. */
  pendingMultiplier: string;
  /** Two-letter ISIN prefix, or null when no ISIN is published. */
  domicile: string | null;
  isin: string | null;
  fractional: "tradable" | "not-tradable" | "unknown";
  feed: FeedRef | null;
  pool: PoolRef | null;
  priceSource: PriceSource;
};

/** Aggregate facts about the universe, computed from the rows. */
export type UniverseSummary = {
  assets: number;
  feeds: number;
  withoutFeed: number;
  /** Assets with a feed and a pool. */
  bothSources: number;
  /** Assets with a pool but no published feed — priceable, but with no official reference. */
  poolOnly: number;
  /** Assets with a feed but no pool found by the scan. */
  feedOnly: number;
  /** Assets with no price source at all within the scanned venues. */
  noPriceSource: number;
  /** Assets whose multiplier differs from 1 by more than 10% — split territory. */
  multiplierOutliers: number;
  /** Assets that cannot be traded in fractional units. */
  nonFractional: number;
  /** Assets domiciled outside the United States. */
  nonUs: number;
  /** Feed entries whose name breaks the `TICKER / USD` convention. */
  nonStandardNames: string[];
  /** Distinct domiciles with counts, most common first. */
  domiciles: { code: string; count: number }[];
  /** The heartbeat every published equity feed declares, in seconds. */
  publishedHeartbeat: number | null;
  /** When the pool scan behind the coverage numbers was taken. */
  poolScannedAt: string;
};
