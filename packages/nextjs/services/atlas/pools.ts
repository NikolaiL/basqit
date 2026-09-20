import coverage from "./pool-coverage.json";

/**
 * Uniswap v3 pool coverage per token, produced by an offline scan and committed as a dataset.
 *
 * It is not fetched at request time on purpose: the scan is roughly 2,300 `eth_call`s across 194
 * tokens, which is fine once and far too slow per page view.
 *
 * **These numbers are a floor.** The scan covers the v3 factory against WETH and USDG at four fee
 * tiers. Uniswap v4 holds the majority of equity DEX liquidity on this chain and is not covered —
 * v4 pools live behind a singleton with hook-dependent ids, so they cannot be enumerated the same
 * way. A token showing nothing here may still trade.
 */
export type PoolEntry = {
  /** Quote asset this pool pairs the token against. */
  quote: string;
  /** Fee tier in hundredths of a basis point, as the factory reports it. */
  fee: number;
  pool: string;
  liquidity: string;
  /** True when the stock token is `token0` of the pair. */
  tokenIsToken0: boolean;
  /** Decimals of the quote asset, needed to interpret the pool ratio. */
  quoteDecimals: number;
};

export const POOL_SCAN = {
  factory: coverage.factory,
  quotes: coverage.quotes as Record<string, string>,
  feeTiers: coverage.feeTiers as number[],
  scannedAt: coverage.scannedAt,
  note: coverage.note,
  /** True when v4 coverage is missing, which makes every count below a lower bound. */
  isFloor: true,
};

const TOKENS = coverage.tokens as Record<string, PoolEntry[]>;

/**
 * How much liquidity stands behind a pool price.
 *
 * Depth varies by more than eight orders of magnitude across this universe, and a spot ratio from a
 * near-empty pool is a number without a market behind it. Treating every pool as equally priceable
 * would repeat the exact mistake this map exists to expose.
 */
export type PoolDepth = "deep" | "moderate" | "thin" | "dust";

/**
 * Below this, a pool's ratio is not treated as a usable price. Expressed in **raw** `liquidity()`
 * units — the convention every helper here follows, so the constant and its comparisons cannot drift
 * apart. Chosen from the measured distribution: the median pool holds 0.475e18.
 */
export const MIN_USABLE_LIQUIDITY = 1e18;

/** Raw `liquidity()` value to a depth tier. */
export const depthOf = (rawLiquidity: number): PoolDepth => {
  if (rawLiquidity <= 0) return "dust";
  if (rawLiquidity > 100 * MIN_USABLE_LIQUIDITY) return "deep";
  if (rawLiquidity >= MIN_USABLE_LIQUIDITY) return "moderate";
  if (rawLiquidity >= 0.01 * MIN_USABLE_LIQUIDITY) return "thin";
  return "dust";
};

/** Every non-empty pool found for a token, deepest first. Null when the scan found none. */
export const poolsFor = (symbol: string): PoolEntry[] | null => {
  const entries = TOKENS[symbol];
  return entries && entries.length > 0 ? entries : null;
};

/** The depth of a token's deepest pool, or null when it has none. */
export const poolDepthFor = (symbol: string): PoolDepth | null => {
  const entries = TOKENS[symbol];
  if (!entries || entries.length === 0) return null;
  return depthOf(Number(entries[0].liquidity));
};
