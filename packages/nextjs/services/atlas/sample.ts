/**
 * The worked example used for the side-by-side comparison.
 *
 * AAPL is chosen because a real swap through this exact pool was observed while the feed was stale —
 * see the transaction in `basqit-docs/docs/ATLAS-RISK-MAP.md` §7b. It is a documented, checkable case
 * rather than an arbitrary pick.
 */
export const SAMPLE = {
  symbol: "AAPL",
  /** AAPL / USD, the official Chainlink feed. */
  feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0",
  /** AAPL / WETH at fee tier 500 — the deepest pool for this token, and the one the sample swap used. */
  pool: "0x8bb3514e2204e1cdf3ac149efee7ff04d91b719f",
  /** The quote asset of that pool, and its own Chainlink feed. */
  quoteFeed: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9",
} as const;
