import { useTransactor } from "./useTransactor";
import { useQuery } from "@tanstack/react-query";
import { encodeFunctionData } from "viem";
import { useWalletClient } from "wagmi";
import { tradeTokenAbi } from "~~/contracts/externalContracts";
import { atlasClient, robinhoodChain } from "~~/services/atlas/client";
import { NATIVE } from "~~/services/funding/shared";
import { ALLOWANCE_HOLDER, type ExecutionQuote, ZEROX_ENABLED } from "~~/services/trading/quote";
import { V3_ROUTER } from "~~/services/trading/uniswap";

export function useStockTrade() {
  const { data: wallet } = useWalletClient();
  const transact = useTransactor(wallet);

  async function checkWallet(quote: ExecutionQuote) {
    if (quote.provider === "0x" && !ZEROX_ENABLED) throw new Error("0x swaps are currently disabled. Use Direct DEX.");
    const expected = quote.provider === "uniswap" ? V3_ROUTER : ALLOWANCE_HOLDER;
    if (
      quote.spender?.toLowerCase() !== expected.toLowerCase() ||
      quote.transaction.to.toLowerCase() !== expected.toLowerCase()
    )
      throw new Error("Unexpected swap contract. Request a new quote.");
    if (
      !wallet ||
      (await wallet.getChainId()) !== robinhoodChain.id ||
      (await wallet.getAddresses())[0]?.toLowerCase() !== quote.taker.toLowerCase()
    )
      throw new Error("Wallet or network changed. Connect the quoted wallet and request a new quote.");
    return wallet;
  }

  async function send(quote: ExecutionQuote, to: `0x${string}`, data: `0x${string}`, swap = false) {
    const client = await checkWallet(quote);
    const tx = { account: quote.taker, chain: robinhoodChain, to, data, value: 0n };
    // Estimate against current state before asking the wallet to sign; no API-supplied gas overrides.
    await atlasClient.estimateGas(tx);
    await checkWallet(quote);
    if (swap && Date.now() >= quote.expiresAt) throw new Error("Quote expired. Request a new quote.");
    const hash = await transact(() => client.sendTransaction(tx));
    if (!hash) throw new Error("Transaction was not submitted.");
    return hash;
  }

  async function approve(quote: ExecutionQuote) {
    await checkWallet(quote);
    const allowance = await atlasClient.readContract({
      address: quote.sellToken,
      abi: tradeTokenAbi,
      functionName: "allowance",
      args: [quote.taker, quote.spender],
    });
    if (allowance >= BigInt(quote.sellAmount)) return;
    // Tokens that require a zero allowance before changing it get a separate confirmed reset.
    if (allowance > 0n)
      await send(
        quote,
        quote.sellToken,
        encodeFunctionData({ abi: tradeTokenAbi, functionName: "approve", args: [quote.spender, 0n] }),
      );
    await send(
      quote,
      quote.sellToken,
      encodeFunctionData({
        abi: tradeTokenAbi,
        functionName: "approve",
        args: [quote.spender, BigInt(quote.sellAmount)],
      }),
    );
  }

  async function swap(quote: ExecutionQuote) {
    await checkWallet(quote);
    if (Date.now() >= quote.expiresAt) throw new Error("Quote expired. Request a new quote.");
    const [balance, allowance] = await Promise.all([
      atlasClient.readContract({
        address: quote.sellToken,
        abi: tradeTokenAbi,
        functionName: "balanceOf",
        args: [quote.taker],
      }),
      atlasClient.readContract({
        address: quote.sellToken,
        abi: tradeTokenAbi,
        functionName: "allowance",
        args: [quote.taker, quote.spender],
      }),
    ]);
    if (balance < BigInt(quote.sellAmount) || allowance < BigInt(quote.sellAmount))
      throw new Error("Balance or allowance changed. Request a new quote.");
    return send(quote, quote.transaction.to, quote.transaction.data, true);
  }
  return { approve, swap };
}

export function useTradeBalance(token: `0x${string}`, owner?: `0x${string}`) {
  return useQuery({
    queryKey: ["trade-balance", robinhoodChain.id, token, owner],
    enabled: !!owner,
    staleTime: 15000,
    refetchInterval: 15000,
    queryFn: async () => {
      if (token.toLowerCase() === NATIVE)
        return { balance: await atlasClient.getBalance({ address: owner! }), decimals: 18 };
      const [balance, decimals] = await Promise.all([
        atlasClient.readContract({ address: token, abi: tradeTokenAbi, functionName: "balanceOf", args: [owner!] }),
        atlasClient.readContract({ address: token, abi: tradeTokenAbi, functionName: "decimals" }),
      ]);
      return { balance, decimals };
    },
  });
}
