import { readTokenData } from "./token-data";

export async function readQuoteDetails(symbol: string): Promise<unknown> {
  if (!/^[A-Z0-9.\-]{1,20}$/.test(symbol)) throw new Error("Invalid symbol");
  const payload = await readTokenData(`prices/${symbol}`);
  const quote = payload.quotes.find((q: { tokenSymbol?: string }) => q?.tokenSymbol === symbol);
  if (
    !quote ||
    quote.currency !== "USD" ||
    typeof quote.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(quote.generatedAt))
  )
    throw new Error("Invalid quote");
  return quote;
}
