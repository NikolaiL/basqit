import { packStocks, payoutStock } from "./stocks.ts";
import assert from "node:assert/strict";

const shared = {
  Packs2StockToken: { address: "0xA9F75D1860DBa205bbbCd8AE76E0443e1198eD03" },
  Packs2StockAAPL: { address: "0x4C9a8466Cf5c1Fbe3dB6e37fA9cC8A8c76e102E5" },
  Packs2StockMETA: { address: "0x3989B5228cb756AC728Cf07725fa963416976b18" },
  Packs2StockAMZN: { address: "0x49e7f31396F6e1B8C6546cC14d6DaE538a4C06F7" },
  Packs2StockTSLA: { address: "0x71fD61B033AF197f26Dc60ED00ea88a1BA841063" },
};
const stocks = packStocks(shared);
assert.equal(stocks.length, 5);
assert.deepEqual(stocks.map(stock => stock.ticker).sort(), ["AAPL", "AMZN", "META", "NVDA", "TSLA"]);
assert.equal(payoutStock(shared.Packs2StockMETA.address.toUpperCase(), stocks).ticker, "META");
assert.equal(stocks.find(stock => stock.ticker === "META").faucet, undefined);
const local = packStocks({ Packs2StockMSFT: { address: "0x1234" } });
assert.equal(local[0].ticker, "MSFT");
assert.equal(local[0].faucet, "Packs2FaucetMSFT");
assert.equal(payoutStock("0x5678", stocks).ticker, "TOKEN");
