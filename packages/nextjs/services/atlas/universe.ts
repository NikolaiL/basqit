import { MIN_USABLE_LIQUIDITY, POOL_SCAN, depthOf, poolsFor } from "./pools";
import type { FeedRef, PriceSource, RawAsset, RawFeed, UniverseRow, UniverseSummary } from "./types";

const ASSETS_URL = "https://api.robinhood.com/rhj/assets";
const FEEDS_URL = "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";

export type Universe = {
  rows: UniverseRow[];
  summary: UniverseSummary;
  fetchedAt: string;
  sources: { assets: string; feeds: string };
};

/**
 * Pull a ticker out of a feed name.
 *
 * The directory is not consistent: most entries read `Robinhood AAPL / USD`, but a few
 * use a hyphen instead of a slash. Matching on the leading alphanumeric run handles both,
 * which a split on "/" would not — it would drop the hyphenated entries without error.
 */
const tickerOf = (name: string): string => {
  const rest = name.replace(/^Robinhood\s+/, "").trim();
  return (rest.match(/^[A-Za-z0-9.]+/)?.[0] ?? "").toUpperCase();
};

/** Only the `Robinhood ...` entries describe tokenized equities; the rest are crypto feeds. */
const isEquityFeed = (feed: RawFeed): boolean => /^Robinhood\s/.test(feed.name ?? "");

const toFeedRef = (feed: RawFeed): FeedRef => ({
  name: feed.name,
  address: feed.proxyAddress,
  decimals: feed.decimals,
  heartbeat: feed.heartbeat,
  threshold: feed.threshold,
  marketHours: feed.docs?.marketHours ?? null,
  feedType: feed.feedType || null,
  nameIsNonStandard: !feed.name.includes("/"),
});

const fractionalOf = (asset: RawAsset): UniverseRow["fractional"] => {
  const value = asset.tradingCapabilities?.market?.fractional;
  if (!value) return "unknown";
  return value === "TRADING_STATUS_TRADABLE" ? "tradable" : "not-tradable";
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return (await response.json()) as T;
};

/**
 * Build the joined universe.
 *
 * The join is a left join from assets to feeds: every listed token appears, whether or not
 * a feed is published for it. That asymmetry is the point — most listed tokens have none.
 */
export const getUniverse = async (): Promise<Universe> => {
  const [assetPayload, feedPayload] = await Promise.all([
    fetchJson<{ assets: RawAsset[] }>(ASSETS_URL),
    fetchJson<RawFeed[]>(FEEDS_URL),
  ]);

  const assets = assetPayload.assets ?? [];
  const feeds = (feedPayload ?? []).filter(isEquityFeed);

  const feedByTicker = new Map<string, RawFeed>();
  for (const feed of feeds) feedByTicker.set(tickerOf(feed.name), feed);

  const rows: UniverseRow[] = assets
    .map(asset => {
      const feed = feedByTicker.get(asset.tokenSymbol.toUpperCase());
      const isin = asset.isin && asset.isin.length >= 2 ? asset.isin : null;
      const pool = poolsFor(asset.tokenSymbol);
      // Raw `liquidity()` units, matching MIN_USABLE_LIQUIDITY.
      const poolLiquidity = pool ? Number(pool[0].liquidity) : 0;
      // A pool only counts as a price source when it is deep enough to have a market behind it.
      const usablePool = pool !== null && poolLiquidity >= MIN_USABLE_LIQUIDITY;
      const priceSource: PriceSource = feed && usablePool ? "both" : feed ? "feed" : usablePool ? "pool" : "none";
      return {
        symbol: asset.tokenSymbol,
        name: asset.tokenName.replace(/\s*•\s*Robinhood Token$/, ""),
        address: asset.deployments?.[0]?.contractAddress ?? "",
        decimals: asset.tokenDecimals,
        multiplier: asset.currentMultiplier,
        multiplierValue: Number(asset.currentMultiplier),
        pendingMultiplier: asset.pendingMultiplier ?? "",
        domicile: isin ? isin.slice(0, 2) : null,
        isin,
        fractional: fractionalOf(asset),
        feed: feed ? toFeedRef(feed) : null,
        pool: pool
          ? {
              v3Pools: pool.length,
              quotes: [...new Set(pool.map(entry => entry.quote))],
              depth: depthOf(poolLiquidity),
            }
          : null,
        priceSource,
      };
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const domicileCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.domicile) continue;
    domicileCounts.set(row.domicile, (domicileCounts.get(row.domicile) ?? 0) + 1);
  }

  const heartbeats = new Set(feeds.map(feed => feed.heartbeat));

  const summary: UniverseSummary = {
    assets: rows.length,
    feeds: feeds.length,
    withoutFeed: rows.filter(row => !row.feed).length,
    bothSources: rows.filter(row => row.priceSource === "both").length,
    poolOnly: rows.filter(row => row.priceSource === "pool").length,
    feedOnly: rows.filter(row => row.priceSource === "feed").length,
    noPriceSource: rows.filter(row => row.priceSource === "none").length,
    multiplierOutliers: rows.filter(row => Math.abs(row.multiplierValue - 1) > 0.1).length,
    nonFractional: rows.filter(row => row.fractional === "not-tradable").length,
    nonUs: rows.filter(row => row.domicile && row.domicile !== "US").length,
    nonStandardNames: rows.filter(row => row.feed?.nameIsNonStandard).map(row => row.symbol),
    domiciles: [...domicileCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    publishedHeartbeat: heartbeats.size === 1 ? [...heartbeats][0] : null,
    poolScannedAt: POOL_SCAN.scannedAt,
  };

  return {
    rows,
    summary,
    fetchedAt: new Date().toISOString(),
    sources: { assets: ASSETS_URL, feeds: FEEDS_URL },
  };
};
