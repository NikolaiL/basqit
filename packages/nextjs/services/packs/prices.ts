/** USDG (6 decimals) per whole token from a mainnet quote: the mid of token bid and ask. `null` when unusable. */
export function midPriceUsdG(quote: { currency?: unknown; tokenBid?: unknown; tokenAsk?: unknown }): bigint | null {
  const bid = Number(quote.tokenBid);
  const ask = Number(quote.tokenAsk);
  if (quote.currency !== "USD" || !(bid > 0) || !(ask > 0)) return null;
  return BigInt(Math.round(((bid + ask) / 2) * 1e6));
}
