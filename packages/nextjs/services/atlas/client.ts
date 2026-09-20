import { createPublicClient, http } from "viem";

/**
 * Robinhood Chain mainnet, as viem needs to see it for direct reads.
 *
 * `contracts.multicall3` must be declared, or viem refuses to batch and every read becomes its own
 * round trip.
 *
 * The address is the **canonical** Multicall3 deployment, not the one this chain's documentation
 * lists. The documented address (`0x2cAC2D899eCC914d704FeaAE33ac1bF36277DaD1`) holds code and answers
 * `getBlockNumber`, `getCurrentBlockTimestamp` and `getEthBalance` — but `aggregate3` reverts on it,
 * so batching against it fails while single reads against it would appear to work. Verified by
 * calling `aggregate3` on both through viem: the canonical address returns a feed answer, the
 * documented one returns a failure.
 */
export const robinhoodChain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
} as const;

export const atlasClient = createPublicClient({ chain: robinhoodChain, transport: http() });

/** Minimal `AggregatorV3Interface`, which every Chainlink feed implements. */
export const aggregatorAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

/** The `slot0` view every Uniswap v3 pool exposes. */
export const poolAbi = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
] as const;

/** Feeds used only to convert a pool's quote asset into dollars. */
export const QUOTE_USD_FEEDS: Record<string, { address: `0x${string}`; symbol: string }> = {
  WETH: { address: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9", symbol: "ETH / USD" },
  USDG: { address: "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2", symbol: "USDG / USD" },
};

/**
 * Convert a v3 `sqrtPriceX96` into "how much token1 per one token0".
 *
 * The arithmetic runs in `bigint`: `sqrtPriceX96` is a Q64.96 value near 2^96, and squaring it
 * exceeds what a double can hold exactly. Scaling by 1e18 before the division keeps enough
 * precision to report a price to the cent.
 */
export const price1Per0 = (sqrtPriceX96: bigint, decimals0: number, decimals1: number): number => {
  const Q96 = 2n ** 96n;
  const scaled = (sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n) / (Q96 * Q96);
  const base = Number(scaled) / 1e18;
  return base * 10 ** (decimals0 - decimals1);
};
