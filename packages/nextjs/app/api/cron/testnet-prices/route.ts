import { NextRequest, NextResponse } from "next/server";
import { createWalletClient, erc20Abi, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { midPriceUsdG } from "~~/services/packs/prices";
import { packsClient, packsTestnet, robinhoodTestnet, testnetAssets } from "~~/services/packs/testnet";
import { readQuoteDetails } from "~~/services/portfolio/quote-details";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Vercel Cron, every 5 minutes (vercel.json). Testnet only: sets the testnet swap adapter's price of each listed test
 * Stock Token to the live mainnet Stock Token mid price, the same as `script/sync-gift-prices.sh`.
 * Needs CRON_SECRET and TESTNET_PRICE_SETTER_PRIVATE_KEY (the adapter owner; a throwaway testnet key).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = process.env.TESTNET_PRICE_SETTER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key || !packsTestnet) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const shop = { address: packsTestnet.swapAdapter, abi: packsTestnet.abis.swapAdapter } as const;
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: robinhoodTestnet, transport: http() });
  const { stocks } = await testnetAssets();
  const results: Record<string, string> = {};

  // Sequential so each transaction gets the next nonce.
  for (const token of [...new Set(stocks)]) {
    const symbol = await packsClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" });
    // tWETH has a fixed testnet price and no Stock Token quote feed.
    if (symbol === "tWETH") continue;
    try {
      const price = midPriceUsdG((await readQuoteDetails(symbol.replace(/^t/, ""))) as Record<string, unknown>);
      if (!price) throw new Error("no usable quote");
      const current = (await packsClient.readContract({ ...shop, functionName: "priceUsdG", args: [token] })) as bigint;
      if (price === current) {
        results[symbol] = "unchanged";
        continue;
      }
      const hash = await wallet.writeContract({ ...shop, functionName: "setPrice", args: [token, price] });
      await packsClient.waitForTransactionReceipt({ hash });
      results[symbol] = `${current} -> ${price}`;
    } catch (failure) {
      results[symbol] = `failed: ${failure instanceof Error ? failure.message.split("\n")[0] : "unknown"}`;
    }
  }
  return NextResponse.json(results, { headers: { "Cache-Control": "no-store" } });
}
