import { useTransactor } from "./useTransactor";
import { useQuery } from "@tanstack/react-query";
import { BaseError, encodeFunctionData } from "viem";
import { useWalletClient } from "wagmi";
import { tradeTokenAbi } from "~~/contracts/externalContracts";
import { trackSwap } from "~~/services/analytics/events";
import { atlasClient, robinhoodChain } from "~~/services/atlas/client";
import { NATIVE } from "~~/services/funding/shared";
import type { BatchQuote, BatchStep } from "~~/services/trading/batch";
import { LIFI_DIAMOND } from "~~/services/trading/lifi";
import { ALLOWANCE_HOLDER, type ExecutionQuote, type TradeQuote, USDG, ZEROX_ENABLED } from "~~/services/trading/quote";
import { V3_ROUTER } from "~~/services/trading/uniswap";

export function useStockTrade() {
  const { data: wallet } = useWalletClient();
  const transact = useTransactor(wallet);

  async function checkWallet(quote: ExecutionQuote) {
    if (quote.provider === "0x" && !ZEROX_ENABLED) throw new Error("0x swaps are currently disabled. Use Direct DEX.");
    const expected = { uniswap: V3_ROUTER, "0x": ALLOWANCE_HOLDER, lifi: LIFI_DIAMOND }[quote.provider];
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

  async function send(
    quote: ExecutionQuote,
    to: `0x${string}`,
    data: `0x${string}`,
    swap = false,
    submitted?: () => void,
  ) {
    const client = await checkWallet(quote);
    const tx = { account: quote.taker, chain: robinhoodChain, to, data, value: 0n };
    // Estimate against current state before asking the wallet to sign; no API-supplied gas overrides.
    const required = await estimateNetworkFee(tx);
    if ((await atlasClient.getBalance({ address: quote.taker })) < required)
      throw new Error("Not enough ETH on Robinhood Chain for network fees. Add ETH and try again.");
    await checkWallet(quote);
    if (swap && Date.now() >= quote.expiresAt) throw new Error("Quote expired. Request a new quote.");
    const hash = await transact(async () => {
      const hash = await client.sendTransaction(tx);
      submitted?.();
      return hash;
    });
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
    // USDG accepts a direct change (verified on a fork of chain 4663), so it skips the extra transaction.
    if (allowance > 0n && quote.sellToken.toLowerCase() !== USDG.toLowerCase())
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

  const events = (legs: TradeQuote[], batch: boolean) =>
    legs.map(leg => ({
      swap_type: batch ? "batch" : "single",
      provider: leg.provider,
      source_chain: robinhoodChain.id,
      destination_chain: robinhoodChain.id,
      sell_token: leg.sellToken,
      buy_token: leg.buyToken,
      sell_amount_raw: leg.sellAmount,
      sell_decimals: leg.sellDecimals,
      buy_decimals: leg.buyDecimals,
      quoted_buy_amount_raw: leg.buyAmount,
      fee_bps: leg.basqitFee.bps,
    }));

  /**
   * EIP-5792: approvals and every purchase go to the wallet as one atomic batch — one confirmation,
   * all or nothing. Returns null when the wallet cannot batch atomically, so the caller falls back to steps.
   */
  async function buyAtomic(quote: BatchQuote) {
    for (const step of quote.steps) await checkWallet(step);
    const client = wallet!;
    const capabilities = await client
      .getCapabilities({ account: quote.taker, chainId: robinhoodChain.id })
      .catch(() => undefined);
    const status = (capabilities as { atomic?: { status?: string } } | undefined)?.atomic?.status;
    if (status !== "supported" && status !== "ready") return null;
    if (Date.now() >= quote.expiresAt) throw new Error("Quote expired. Request a new quote.");
    const calls = [
      ...quote.approvals
        .filter(item => BigInt(item.allowance) < BigInt(item.sellAmount))
        .map(item => ({
          to: USDG as `0x${string}`,
          data: encodeFunctionData({
            abi: tradeTokenAbi,
            functionName: "approve",
            args: [item.spender, BigInt(item.sellAmount)],
          }),
        })),
      ...quote.steps.map(step => ({ to: step.transaction.to, data: step.transaction.data })),
    ];
    return trackSwap(events(quote.legs, true), async submitted => {
      let id: string;
      try {
        ({ id } = await client.sendCalls({ account: quote.taker, chain: robinhoodChain, calls, forceAtomic: true }));
      } catch (error) {
        // EIP-5792 errors 5700–5760 mean the wallet declined the batch shape, not the user: use separate steps.
        const walletCode = (e: unknown) => {
          const code = e && typeof e === "object" && "code" in e ? (e as { code: unknown }).code : undefined;
          return typeof code === "number" && code >= 5700 && code <= 5760;
        };
        if (error instanceof BaseError ? error.walk(walletCode) : walletCode(error)) return null;
        throw error;
      }
      submitted();
      const result = await client.waitForCallsStatus({ id, timeout: 180000 });
      if (result.status !== "success")
        throw new Error("The purchase did not complete, so nothing was bought. Request a new quote and try again.");
      return result.receipts?.at(-1)?.transactionHash ?? null;
    });
  }

  async function swap(quote: TradeQuote | BatchStep) {
    const legs = "legs" in quote ? quote.legs : [quote];
    return trackSwap(
      legs.map(leg => ({
        swap_type: "legs" in quote ? "batch" : "single",
        provider: leg.provider,
        source_chain: robinhoodChain.id,
        destination_chain: robinhoodChain.id,
        sell_token: leg.sellToken,
        buy_token: leg.buyToken,
        sell_amount_raw: leg.sellAmount,
        sell_decimals: leg.sellDecimals,
        buy_decimals: leg.buyDecimals,
        quoted_buy_amount_raw: leg.buyAmount,
        fee_bps: leg.basqitFee.bps,
      })),
      async submitted => {
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
        return send(quote, quote.transaction.to, quote.transaction.data, true, submitted);
      },
    );
  }
  return { approve, swap, buyAtomic };
}

/** True when the wallet can confirm a whole purchase as one atomic EIP-5792 batch on Robinhood Chain. */
export function useAtomicBatch(owner?: `0x${string}`) {
  const { data: wallet } = useWalletClient();
  return (
    useQuery({
      queryKey: ["atomic-batch", robinhoodChain.id, owner, wallet?.uid],
      enabled: !!wallet && !!owner,
      staleTime: 300000,
      retry: false,
      queryFn: async () => {
        const capabilities = await wallet!
          .getCapabilities({ account: owner!, chainId: robinhoodChain.id })
          .catch(() => undefined);
        const status = (capabilities as { atomic?: { status?: string } } | undefined)?.atomic?.status;
        return status === "supported" || status === "ready";
      },
    }).data ?? false
  );
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

async function estimateNetworkFee(tx: {
  account: `0x${string}`;
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
}) {
  const [gas, fees] = await Promise.all([atlasClient.estimateGas(tx), atlasClient.estimateFeesPerGas()]);
  return (gas * fees.maxFeePerGas * 120n + 99n) / 100n;
}

// Estimate the next wallet action, including approval/reset when necessary.
export function useTradeGas(quote?: ExecutionQuote) {
  const balance = useTradeBalance(NATIVE, quote?.taker);
  const query = useQuery({
    queryKey: [
      "trade-gas",
      quote?.taker,
      quote?.sellToken,
      quote?.sellAmount,
      quote?.transaction.data,
      quote?.expiresAt,
    ],
    enabled: !!quote,
    staleTime: 15000,
    retry: false,
    queryFn: async () => {
      if (!quote) throw new Error("Quote unavailable");
      const allowance = await atlasClient.readContract({
        address: quote.sellToken,
        abi: tradeTokenAbi,
        functionName: "allowance",
        args: [quote.taker, quote.spender],
      });
      const approval = allowance < BigInt(quote.sellAmount);
      const tx = approval
        ? {
            to: quote.sellToken,
            data: encodeFunctionData({
              abi: tradeTokenAbi,
              functionName: "approve",
              args: [quote.spender, allowance > 0n ? 0n : BigInt(quote.sellAmount)],
            }),
          }
        : quote.transaction;
      return estimateNetworkFee({ account: quote.taker, to: tx.to, data: tx.data, value: 0n });
    },
  });
  return {
    ...query,
    insufficient:
      balance.data?.balance === 0n ||
      (balance.data !== undefined && query.data !== undefined && balance.data.balance < query.data),
  };
}
