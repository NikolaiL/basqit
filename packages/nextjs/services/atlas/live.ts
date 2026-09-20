import { aggregatorAbi, atlasClient, poolAbi } from "./client";
import { SAMPLE } from "./sample";

/**
 * One asset read from both price sources at the same instant.
 *
 * This is the comparison the map exists to make. The feed and the pool are sampled together so the
 * gap between them is attributable to the sources themselves, not to the clock.
 */

export type LiveComparison = {
  symbol: string;
  feedPrice: number;
  feedAgeSeconds: number;
  /** Price implied by the pool, in USD, via the quote asset's own feed. */
  poolPrice: number;
  quoteUsd: number;
  divergencePct: number;
  poolAddress: string;
  error?: string;
};

export const getLiveComparison = async (): Promise<LiveComparison> => {
  const base: LiveComparison = {
    symbol: SAMPLE.symbol,
    feedPrice: 0,
    feedAgeSeconds: 0,
    poolPrice: 0,
    quoteUsd: 0,
    divergencePct: 0,
    poolAddress: SAMPLE.pool,
  };

  try {
    const [aaplRound, quoteRound, slot0, block] = await Promise.all([
      atlasClient.readContract({
        address: SAMPLE.feed as `0x${string}`,
        abi: aggregatorAbi,
        functionName: "latestRoundData",
      }),
      atlasClient.readContract({
        address: SAMPLE.quoteFeed as `0x${string}`,
        abi: aggregatorAbi,
        functionName: "latestRoundData",
      }),
      atlasClient.readContract({
        address: SAMPLE.pool as `0x${string}`,
        abi: poolAbi,
        functionName: "slot0",
      }),
      atlasClient.getBlock({ blockTag: "latest" }),
    ]);

    const feedPrice = Number(aaplRound[1]) / 1e8;
    const updatedAt = Number(aaplRound[3]);
    const quoteUsd = Number(quoteRound[1]) / 1e8;

    // In this pool the quote asset is token0 and the stock is token1, both 18 decimals, so the raw
    // ratio is stock per quote and the dollar price is the quote's price divided by it.
    const sqrt = slot0[0] as bigint;
    const Q96 = 2n ** 96n;
    const stockPerQuote = Number((sqrt * sqrt * 10n ** 18n) / (Q96 * Q96)) / 1e18;
    const poolPrice = quoteUsd / stockPerQuote;

    return {
      ...base,
      feedPrice,
      feedAgeSeconds: Number(block.timestamp) - updatedAt,
      poolPrice,
      quoteUsd,
      divergencePct: ((poolPrice - feedPrice) / feedPrice) * 100,
    };
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
};
