import { QUOTE_USD_FEEDS, aggregatorAbi, atlasClient, poolAbi, price1Per0 } from "./client";
import coverage from "./pool-coverage.json";
import { MIN_USABLE_LIQUIDITY } from "./pools";
import type { UniverseRow } from "./types";

/**
 * The price of one token, together with where it came from and how old it is.
 *
 * The provenance fields are not decoration. A bare number is exactly the failure this map exists to
 * expose: a contract that reads `latestAnswer()` and trusts it has no way to tell a fresh price from
 * one that has been frozen since Friday's close, or an official price from a pool's spot ratio.
 */
export type TokenPrice = {
  /** Price in USD, or null when neither source could supply one. */
  usd: number | null;
  source: "feed" | "pool" | "none";
  /** Seconds since the source last changed, for feeds. Null for a pool, which is always current. */
  ageSeconds: number | null;
  /** Quote asset behind a pool price. */
  quote: string | null;
  /** Human-readable provenance, shown on hover. */
  detail: string;
};

type PoolEntry = {
  quote: string;
  fee: number;
  pool: string;
  liquidity: string;
  tokenIsToken0: boolean;
  quoteDecimals: number;
};

const TOKEN_DECIMALS = 18;

const bestPools = coverage.tokens as Record<string, PoolEntry[]>;

const readFeed = async (address: `0x${string}`) => {
  const round = await atlasClient.readContract({
    address,
    abi: aggregatorAbi,
    functionName: "latestRoundData",
  });
  return { answer: Number(round[1]) / 1e8, updatedAt: Number(round[3]) };
};

/**
 * Read a price for every token that has a source.
 *
 * Batched deliberately: a feed read and a pool read per token is ~130 calls, which is tolerable only
 * because they go out as multicalls. Reading them one at a time would make the page unusable.
 */
export const getPrices = async (rows: UniverseRow[]): Promise<Map<string, TokenPrice>> => {
  const out = new Map<string, TokenPrice>();
  for (const row of rows) {
    out.set(row.symbol, { usd: null, source: "none", ageSeconds: null, quote: null, detail: "no source" });
  }

  const block = await atlasClient.getBlock({ blockTag: "latest" });
  const now = Number(block.timestamp);

  // Quote assets, needed to turn a pool ratio into dollars.
  const quoteUsd = new Map<string, number>();
  await Promise.all(
    Object.entries(QUOTE_USD_FEEDS).map(async ([key, cfg]) => {
      try {
        const { answer } = await readFeed(cfg.address);
        quoteUsd.set(key, answer);
      } catch {
        // A missing quote feed only degrades the tokens priced in that quote.
      }
    }),
  );

  // ---- feeds ----------------------------------------------------------------
  const feedRows = rows.filter(row => row.feed);
  if (feedRows.length > 0) {
    const results = await atlasClient.multicall({
      contracts: feedRows.map(row => ({
        address: row.feed!.address as `0x${string}`,
        abi: aggregatorAbi,
        functionName: "latestRoundData" as const,
      })),
      allowFailure: true,
    });
    results.forEach((result, index) => {
      const row = feedRows[index];
      if (result.status !== "success") return;
      const [, answer, , updatedAt] = result.result as readonly [bigint, bigint, bigint, bigint, bigint];
      const usd = Number(answer) / 1e8;
      if (!Number.isFinite(usd) || usd <= 0) return;
      out.set(row.symbol, {
        usd,
        source: "feed",
        ageSeconds: now - Number(updatedAt),
        quote: null,
        detail: `${row.feed!.name} (official feed)`,
      });
    });
  }

  // ---- pools, for everything a feed did not cover ---------------------------
  const poolRows = rows
    .map(row => ({ row, entry: bestPools[row.symbol]?.[0] }))
    .filter((item): item is { row: UniverseRow; entry: PoolEntry } => Boolean(item.entry))
    .filter(item => out.get(item.row.symbol)?.source !== "feed")
    // A near-empty pool yields a ratio, not a price. Below the floor the token is reported as
    // unpriced rather than given a number nobody could trade at.
    .filter(item => Number(item.entry.liquidity) >= MIN_USABLE_LIQUIDITY);

  if (poolRows.length > 0) {
    const results = await atlasClient.multicall({
      contracts: poolRows.map(item => ({
        address: item.entry.pool as `0x${string}`,
        abi: poolAbi,
        functionName: "slot0" as const,
      })),
      allowFailure: true,
    });
    results.forEach((result, index) => {
      const { row, entry } = poolRows[index];
      const reference = quoteUsd.get(entry.quote);
      if (result.status !== "success" || reference === undefined) return;
      const sqrtPriceX96 = (result.result as readonly unknown[])[0] as bigint;
      if (sqrtPriceX96 === 0n) return;

      const decimals0 = entry.tokenIsToken0 ? TOKEN_DECIMALS : entry.quoteDecimals;
      const decimals1 = entry.tokenIsToken0 ? entry.quoteDecimals : TOKEN_DECIMALS;
      const ratio = price1Per0(sqrtPriceX96, decimals0, decimals1);
      if (!Number.isFinite(ratio) || ratio <= 0) return;

      // `ratio` is token1 per token0. Which side the stock sits on decides the direction.
      const usd = entry.tokenIsToken0 ? reference * ratio : reference / ratio;
      if (!Number.isFinite(usd) || usd <= 0) return;

      out.set(row.symbol, {
        usd,
        source: "pool",
        ageSeconds: null,
        quote: entry.quote,
        detail: `${row.symbol}/${entry.quote} v3 pool, fee ${entry.fee / 10000}% (spot ratio, not an official price)`,
      });
    });
  }

  return out;
};
