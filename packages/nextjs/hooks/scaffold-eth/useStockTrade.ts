import { useEffect } from "react";
import { useTransactor } from "./useTransactor";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { encodeFunctionData } from "viem";
import { useWalletClient } from "wagmi";
import { tradeTokenAbi } from "~~/contracts/externalContracts";
import { trackSwap } from "~~/services/analytics/events";
import { atlasClient, robinhoodChain } from "~~/services/atlas/client";
import { NATIVE } from "~~/services/funding/shared";
import type { BatchQuote, BatchStep } from "~~/services/trading/batch";
import { LIFI_DIAMOND } from "~~/services/trading/lifi";
import {
  type PendingTrade,
  type TradeOutcome,
  assertNoPendingTrade,
  clearPendingTrade,
  isUnsupportedBatch,
  markBatchBought,
  newOperationId,
  provesNotSent,
  readPendingTrade,
  reconcilePendingTrade,
  savePendingTrade,
  withTradeLock,
} from "~~/services/trading/pending";
import { ALLOWANCE_HOLDER, type ExecutionQuote, type TradeQuote, USDG, ZEROX_ENABLED } from "~~/services/trading/quote";
import { V3_ROUTER } from "~~/services/trading/uniswap";
import { APPROVAL_CONFIRMED } from "~~/utils/scaffold-eth/contract";

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
    swap?: { batch?: string },
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
    if (!swap) {
      const hash = await transact(() => client.sendTransaction(tx), { successMessage: APPROVAL_CONFIRMED });
      if (!hash) throw new Error("Transaction was not submitted.");
      return hash;
    }
    const record: PendingTrade = {
      id: newOperationId(),
      taker: quote.taker,
      chainId: robinhoodChain.id,
      kind: "tx",
      tokens: "legs" in quote ? (quote as BatchStep).legs.map(leg => leg.buyToken) : [(quote as TradeQuote).buyToken],
      batch: swap.batch,
      to,
      data,
      createdAt: Date.now(),
    };
    // Check, reserve and send under one per-wallet lock, so a second tab cannot pass the check in between.
    const hash = await withTradeLock(record.chainId, record.taker, async () => {
      assertNoPendingTrade(record.chainId, record.taker);
      return transact(async () => {
        savePendingTrade(record);
        let hash: `0x${string}`;
        try {
          hash = await client.sendTransaction(tx);
        } catch (error) {
          if (provesNotSent(error)) clearPendingTrade(record.chainId, record.taker, record.id);
          throw error;
        }
        savePendingTrade({ ...record, ref: hash });
        submitted?.();
        return hash;
      });
    });
    // Reached only once the receipt says success; a timeout or failed lookup keeps the record for reconciling.
    if (record.batch) markBatchBought(record.chainId, record.taker, record.batch, record.tokens);
    clearPendingTrade(record.chainId, record.taker, record.id);
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
      fee_bps: leg.basqitFee.bps,
    }));

  /**
   * EIP-5792: approvals and every purchase go to the wallet as one atomic batch — one confirmation,
   * all or nothing. Returns null only when the wallet cannot batch atomically; the caller must then ask the
   * buyer before switching to separate steps, which can complete partially.
   */
  async function buyAtomic(quote: BatchQuote, batch?: string): Promise<{ hash?: string } | null> {
    for (const step of quote.steps) await checkWallet(step);
    assertNoPendingTrade(robinhoodChain.id, quote.taker);
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
    const record: PendingTrade = {
      id: newOperationId(),
      taker: quote.taker,
      chainId: robinhoodChain.id,
      kind: "calls",
      tokens: quote.legs.map(leg => leg.buyToken),
      batch,
      createdAt: Date.now(),
    };
    return trackSwap(events(quote.legs, true), async submitted => {
      const id = await withTradeLock(record.chainId, record.taker, async () => {
        assertNoPendingTrade(record.chainId, record.taker);
        savePendingTrade(record);
        try {
          const { id } = await client.sendCalls({
            account: quote.taker,
            chain: robinhoodChain,
            calls,
            forceAtomic: true,
          });
          savePendingTrade({ ...record, ref: id });
          return id;
        } catch (error) {
          if (provesNotSent(error)) clearPendingTrade(record.chainId, record.taker, record.id);
          // Only "cannot do this batch" falls back; 5750 is the buyer refusing and 5720 an already-used id.
          if (isUnsupportedBatch(error)) return null;
          throw error;
        }
      });
      if (!id) return null;
      submitted();
      const result = await client.waitForCallsStatus({ id, timeout: 180000 });
      if (result.status === "failure") {
        clearPendingTrade(record.chainId, record.taker, record.id);
        throw new Error("The purchase did not complete, so nothing was bought. Request a new quote and try again.");
      }
      if (result.status !== "success")
        throw new Error("The purchase is still being confirmed. Check it before buying again.");
      if (batch) markBatchBought(record.chainId, record.taker, batch, record.tokens);
      clearPendingTrade(record.chainId, record.taker, record.id);
      // A confirmed bundle is a success even when the wallet returns no receipt to link to.
      return { hash: result.receipts?.at(-1)?.transactionHash };
    });
  }

  async function swap(quote: TradeQuote | BatchStep, batch?: string) {
    const legs = "legs" in quote ? quote.legs : [quote];
    return trackSwap(events(legs, "legs" in quote), async submitted => {
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
      return send(quote, quote.transaction.to, quote.transaction.data, { batch }, submitted);
    });
  }
  return { approve, swap, buyAtomic };
}

/**
 * The wallet's unresolved trade, checked on chain until it resolves. A resolved record is cleared, its batch legs are
 * marked bought, and the outcome is kept for the notice, so success and failure read differently.
 */
export function usePendingTrade(owner?: `0x${string}`) {
  const { data: wallet } = useWalletClient();
  const client = useQueryClient();
  const outcomeKey = ["trade-outcome", robinhoodChain.id, owner];
  const query = useQuery({
    queryKey: ["pending-trade", robinhoodChain.id, owner],
    enabled: !!owner,
    retry: false,
    refetchInterval: data => (data.state.data ? 10000 : false),
    queryFn: async (): Promise<(PendingTrade & { outcome: TradeOutcome }) | null> => {
      const trade = readPendingTrade(robinhoodChain.id, owner!);
      if (!trade) return null;
      const { outcome, nonce } = await reconcilePendingTrade(trade, {
        receipt: hash => atlasClient.getTransactionReceipt({ hash }),
        transaction: hash => atlasClient.getTransaction({ hash }),
        confirmedNonce: () => atlasClient.getTransactionCount({ address: trade.taker as `0x${string}` }),
        calls: wallet ? id => wallet.getCallsStatus({ id }) : undefined,
      });
      if (outcome === "unknown" || outcome === "replaced" || outcome === "unverified") {
        if (nonce !== undefined && trade.nonce === undefined) savePendingTrade({ ...trade, nonce });
        return { ...trade, nonce, outcome };
      }
      if (outcome === "success" && trade.batch) markBatchBought(trade.chainId, trade.taker, trade.batch, trade.tokens);
      clearPendingTrade(trade.chainId, trade.taker, trade.id);
      client.setQueryData(outcomeKey, { outcome, tokens: trade.tokens });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["trade-batch"] }),
        client.invalidateQueries({ queryKey: ["stock-portfolio"] }),
        client.invalidateQueries({ queryKey: ["trade-balance"] }),
      ]);
      return null;
    },
  });
  const { refetch } = query;
  // Another tab submitting or resolving a trade updates this one at once.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith("basqit-trade-v1:") || event.key?.startsWith("basqit-batch-v1:")) {
        void refetch();
        void client.invalidateQueries({ queryKey: ["trade-batch"] });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refetch, client]);
  const resolved = useQuery<{ outcome: TradeOutcome; tokens: string[] } | null>({
    queryKey: outcomeKey,
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  }).data;
  return {
    ...query,
    resolved,
    /** Manual recovery, as in funding: track a (replacement) hash from wallet history, or confirm the outcome. */
    track: (hash: `0x${string}`) => {
      const trade = query.data;
      if (trade)
        savePendingTrade({
          id: trade.id,
          taker: trade.taker,
          chainId: trade.chainId,
          kind: "tx",
          ref: hash,
          tokens: trade.tokens,
          batch: trade.batch,
          to: trade.to,
          data: trade.data,
          nonce: trade.nonce,
          tracked: true,
          createdAt: trade.createdAt,
        });
      void refetch();
    },
    /** The buyer's own answer from wallet history: whether the purchase went through (its batch legs are then bought). */
    resolve: (bought: boolean) => {
      const trade = query.data;
      if (owner && trade && bought && trade.batch)
        markBatchBought(trade.chainId, trade.taker, trade.batch, trade.tokens);
      if (owner) clearPendingTrade(robinhoodChain.id, owner);
      client.setQueryData(outcomeKey, null);
      void refetch();
      void client.invalidateQueries({ queryKey: ["trade-batch"] });
    },
  };
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
