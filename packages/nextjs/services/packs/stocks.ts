import { type Address } from "viem";

export const PACK_STOCKS = [
  { contract: "Packs2StockToken", faucet: "Packs2StockFaucet", ticker: "NVDA", company: "NVIDIA" },
  { contract: "Packs2StockAAPL", faucet: "Packs2FaucetAAPL", ticker: "AAPL", company: "Apple" },
  { contract: "Packs2StockMSFT", faucet: "Packs2FaucetMSFT", ticker: "MSFT", company: "Microsoft" },
  { contract: "Packs2StockAMZN", faucet: "Packs2FaucetAMZN", ticker: "AMZN", company: "Amazon" },
  { contract: "Packs2StockTSLA", faucet: "Packs2FaucetTSLA", ticker: "TSLA", company: "Tesla" },
] as const;

export type PackStock = { address: Address; ticker: string; company: string };
export function packStocks(registry: Record<string, { address: Address }> = {}): PackStock[] {
  return PACK_STOCKS.flatMap(stock =>
    registry[stock.contract] ? [{ ...stock, address: registry[stock.contract].address }] : [],
  );
}
export function payoutStock(token: Address, stocks: readonly PackStock[]) {
  return (
    stocks.find(stock => stock.address.toLowerCase() === token.toLowerCase()) ?? {
      address: token,
      ticker: "TOKEN",
      company: "Stock Tokens",
    }
  );
}
