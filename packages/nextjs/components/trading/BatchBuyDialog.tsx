"use client";

import { useEffect, useRef, useState } from "react";
import { FundingPanel } from "./FundingPanel";
import { GasFundingNotice } from "./GasFundingNotice";
import { SwapConfetti } from "./SwapConfetti";
import { SwapPayPanel } from "./SwapPayPanel";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatUnits, isAddress } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { DialogClose } from "~~/components/DialogClose";
import { StockLogo } from "~~/components/StockLogo";
import { TokenAmount } from "~~/components/TokenAmount";
import { useAtomicBatch, useStockTrade, useTradeBalance, useTradeGas } from "~~/hooks/scaffold-eth/useStockTrade";
import { useWalletConnectModal } from "~~/hooks/scaffold-eth/useWalletConnectModal";
import { robinhoodChain } from "~~/services/atlas/client";
import type { DiscoveryAsset } from "~~/services/discover/catalog";
import { type BatchQuoteResponse, type BatchStep, mergeQuoteErrors } from "~~/services/trading/batch";
import { type TradeQuote, USDG, balancePercentage } from "~~/services/trading/quote";

// A refreshed quote may be at most 0.5% worse than the one shown: the slippage the buyer already accepted.
const withinSlippage = (fresh: TradeQuote, shown: TradeQuote) =>
  BigInt(fresh.minBuyAmount) * 1000n >= BigInt(shown.minBuyAmount) * 995n;

export function BatchBuyDialog({ assets, onClose }: { assets: DiscoveryAsset[]; onClose: () => void }) {
  const { address, chainId } = useAccount();
  const { openConnectModal, connectModalOpen } = useWalletConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const trade = useStockTrade();
  const client = useQueryClient();
  const balance = useTradeBalance(USDG, address && isAddress(address) ? (address as `0x${string}`) : undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [errorCache, setErrorCache] = useState<{ wallet?: string; errors: Record<string, string> }>({ errors: {} });
  const cachedErrors = errorCache.wallet === address ? errorCache.errors : {};
  const [retryVersion, setRetryVersion] = useState(0);
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  // Lower-case addresses bought in this dialog: shown faded with a check, never offered again.
  const [purchased, setPurchased] = useState<string[]>([]);
  const isBought = (asset: DiscoveryAsset) => purchased.includes(asset.address.toLowerCase());
  const selected = assets.filter(asset => !excluded.includes(asset.address) && !isBought(asset));
  const [input, setInput] = useState<{ key: string; percentage: number; manual?: string }>();
  const inputKey = address ?? "";
  const currentInput = input?.key === inputKey || input?.key === "" ? input : undefined;
  const percentage = currentInput?.percentage ?? 50;
  const amount =
    currentInput?.manual ??
    (balance.data ? balancePercentage(balance.data.balance, balance.data.decimals, percentage) : "");
  const sliderPercentage =
    currentInput?.manual !== undefined && balance.data
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round(
              (Number(amount || 0) / Number(formatUnits(balance.data.balance, balance.data.decimals))) * 100,
            ) || 0,
          ),
        )
      : percentage;
  function choosePercentage(value: number) {
    setInput({ key: inputKey, percentage: value });
    setError("");
  }
  const [debounced, setDebounced] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [hash, setHash] = useState<string>();
  const [now, setNow] = useState(Date.now);
  const tokens = selected.map(asset => asset.address).join(",");
  const valid = /^\d{1,40}(\.\d{1,36})?$/.test(amount) && /[1-9]/.test(amount);
  const ready =
    selected.length > 0 &&
    !!address &&
    chainId === robinhoodChain.id &&
    valid &&
    amount === debounced &&
    !busy &&
    !hash;
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(amount), 600);
    return () => clearTimeout(timer);
  }, [amount]);
  useEffect(() => {
    if (connectModalOpen || fundingOpen) dialog.current?.close();
    else dialog.current?.showModal();
  }, [connectModalOpen, fundingOpen]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const quotes = useQuery<BatchQuoteResponse>({
    queryKey: ["batch-buy", tokens, address, chainId, debounced, retryVersion],
    enabled: ready,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: query =>
      ready && !query.state.error && query.state.data?.quote
        ? Math.max(1000, query.state.data.quote.expiresAt - now)
        : false,
    queryFn: async ({ signal }): Promise<BatchQuoteResponse> => {
      const params = new URLSearchParams({ tokens, taker: address!, amount: debounced });
      const response = await fetch(`/api/swap/batch?${params}`, { signal, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not quote all stocks.");
      return result;
    },
  });
  const response = amount === debounced ? quotes.data : undefined;
  const quote = response?.quote;
  useEffect(() => {
    if (!response || quotes.isFetching || busy || hash) return;
    setErrorCache(previous => ({
      wallet: address,
      errors: mergeQuoteErrors(previous.wallet === address ? previous.errors : {}, response.results),
    }));
    const failed = response.results.filter(result => result.error).map(result => result.token.toLowerCase());
    if (failed.length)
      setExcluded(previous => [
        ...new Set([
          ...previous,
          ...assets.filter(asset => failed.includes(asset.address.toLowerCase())).map(asset => asset.address),
        ]),
      ]);
  }, [response, quotes.isFetching, busy, hash, address, assets]);
  const failedAssets = assets.filter(asset => cachedErrors[asset.address.toLowerCase()]);
  const pendingApprovals = quote?.approvals.filter(item => BigInt(item.allowance) < BigInt(item.sellAmount)) ?? [];
  const atomic = useAtomicBatch(address && isAddress(address) ? (address as `0x${string}`) : undefined);
  const gasEstimate = useTradeGas(pendingApprovals[0] ?? quote?.steps[0]);
  const usable = ready && !!quote && !quotes.isFetching && !quotes.isError && now < quote.expiresAt;
  /** Fresh single-stock LiFi quote for a step whose quote aged while earlier steps were confirmed. */
  async function refreshStep(step: BatchStep): Promise<BatchStep> {
    const [leg] = step.legs;
    if (step.provider !== "lifi" || Date.now() < step.expiresAt - 5000) return step;
    const params = new URLSearchParams({
      token: leg.buyToken,
      taker: leg.taker,
      side: "buy",
      amount: formatUnits(BigInt(leg.sellAmount), leg.sellDecimals),
      provider: "lifi",
    });
    const response = await fetch(`/api/swap?${params}`, { cache: "no-store" });
    const fresh = (await response.json()) as TradeQuote & { error?: string };
    if (!response.ok) throw new Error(fresh.error ?? "Quote unavailable. Retry later.");
    if (
      fresh.provider !== "lifi" ||
      fresh.buyToken.toLowerCase() !== leg.buyToken.toLowerCase() ||
      fresh.sellAmount !== leg.sellAmount ||
      !withinSlippage(fresh, leg)
    )
      throw new Error("The price moved by more than 0.5%.");
    return { ...fresh, legs: [fresh] };
  }
  async function execute() {
    if (lock.current || !usable || !quote) return;
    lock.current = true;
    setError("");
    const bought: string[] = [];
    try {
      setBusy("Confirm the purchase in your wallet…");
      const atomicHash = atomic ? await trade.buyAtomic(quote) : null;
      if (atomicHash) {
        setPurchased(previous => [...previous, ...quote.legs.map(leg => leg.buyToken.toLowerCase())]);
        setHash(atomicHash);
        await Promise.all([
          client.invalidateQueries({ queryKey: ["stock-portfolio"] }),
          client.invalidateQueries({ queryKey: ["trade-balance"] }),
        ]);
        return;
      }
      let executable = quote;
      if (pendingApprovals.length) {
        for (const [i, item] of pendingApprovals.entries()) {
          setBusy(
            pendingApprovals.length > 1
              ? `Approving USDG (${i + 1} of ${pendingApprovals.length})…`
              : "Approving USDG…",
          );
          await trade.approve(item);
        }
        setBusy("Refreshing all quotes…");
        const refreshed = await quotes.refetch();
        if (refreshed.error || !refreshed.data?.quote)
          throw new Error("Approval confirmed. Refresh the quote to continue.");
        executable = refreshed.data.quote;
        if (
          executable.sellAmount !== quote.sellAmount ||
          executable.legs.length !== quote.legs.length ||
          executable.legs.some(
            (leg, i) =>
              leg.buyToken.toLowerCase() !== quote.legs[i].buyToken.toLowerCase() ||
              leg.sellAmount !== quote.legs[i].sellAmount ||
              leg.basqitFee.bps !== quote.legs[i].basqitFee.bps ||
              !withinSlippage(leg, quote.legs[i]),
          )
        )
          throw new Error(
            "Approval confirmed. Prices moved by more than 0.5%; review the new amounts and press Buy again.",
          );
        if (executable.approvals.some(item => BigInt(item.allowance) < BigInt(item.sellAmount)))
          throw new Error("Approval confirmed. Routes changed; press Buy again.");
      }
      // Direct pools settle all stocks in one transaction; stocks routed through LiFi each need their own.
      let confirmed: string | undefined;
      for (const [i, planned] of executable.steps.entries()) {
        setBusy(
          executable.steps.length > 1
            ? `Confirm purchase ${i + 1} of ${executable.steps.length} in your wallet…`
            : "Confirm all purchases in your wallet…",
        );
        const step = await refreshStep(planned);
        confirmed = await trade.swap(step);
        bought.push(...step.legs.map(leg => leg.buyToken.toLowerCase()));
        setPurchased(previous => [...previous, ...step.legs.map(leg => leg.buyToken.toLowerCase())]);
      }
      setHash(confirmed);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["stock-portfolio"] }),
        client.invalidateQueries({ queryKey: ["trade-balance"] }),
      ]);
    } catch (failure) {
      const reason = failure instanceof Error ? failure.message.split("\n")[0] : "Purchase failed. Please try again.";
      if (bought.length) {
        // Completed purchases stay done. The rest keeps its original share, not a new share of the balance.
        const remaining = quote.legs.filter(leg => !bought.includes(leg.buyToken.toLowerCase()));
        setInput({
          key: inputKey,
          percentage,
          manual: formatUnits(
            remaining.reduce((sum, leg) => sum + BigInt(leg.sellAmount), 0n),
            6,
          ),
        });
        void client.invalidateQueries({ queryKey: ["stock-portfolio"] });
        void client.invalidateQueries({ queryKey: ["trade-balance"] });
        setError(`${reason} Bought ${bought.length} of ${quote.legs.length}; press Buy for the rest.`);
      } else setError(reason);
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="batch-buy-title"
      onCancel={event => {
        event.preventDefault();
        if (!lock.current && !busy) onClose();
      }}
    >
      {/* A paper receipt: white on the light theme, carbon paper on the dark one. */}
      <div className="modal-box bq-batch-buy">
        <DialogClose label="Close purchase" disabled={!!busy} onClick={onClose} />
        <div className="bq-discover-detail-heading">
          <h2 id="batch-buy-title">Buy these stocks</h2>
        </div>
        <p>
          {selected.length
            ? `One total, split equally across ${selected.length} selected ${selected.length === 1 ? "stock" : "stocks"}.`
            : "Select at least one stock to continue."}
        </p>
        <SwapPayPanel
          symbol="USDG"
          balance={balance.data ? formatUnits(balance.data.balance, balance.data.decimals) : undefined}
          connected={!!address}
          balanceError={balance.isError}
          amount={amount}
          percentage={sliderPercentage}
          disabled={!!busy || !!hash}
          percentageDisabled={!balance.data || !!busy || !!hash}
          loading={quotes.isFetching}
          directionLabel="USDG to selected stocks"
          onAmountChange={value => {
            setInput({ key: inputKey, percentage: sliderPercentage, manual: value });
            setError("");
          }}
          onPercentageChange={choosePercentage}
          onBusy={setBusy}
          onFundingOpenChange={setFundingOpen}
          onFunded={!hash ? () => setRetryVersion(value => value + 1) : undefined}
        />
        <div className="bq-batch-scroll" role="region" aria-label="Selected stocks and purchase details" tabIndex={0}>
          <div className="bq-batch-legs">
            {assets
              .filter(asset => showUnavailable || !cachedErrors[asset.address.toLowerCase()])
              .map(asset => {
                const result = response?.results.find(item => item.token.toLowerCase() === asset.address.toLowerCase());
                const leg = result?.quote;
                const failure = result?.error ?? cachedErrors[asset.address.toLowerCase()];
                if (isBought(asset))
                  return (
                    <div className="bq-discover-buy-row bq-buy-done" key={asset.address}>
                      <span className="bq-buy-check" role="img" aria-label="Bought">
                        ✓
                      </span>
                      <StockLogo symbol={asset.symbol} size={32} />
                      <strong>{asset.symbol}</strong>
                      <small className="text-right">Bought</small>
                    </div>
                  );
                return (
                  <label className={`bq-discover-buy-row ${failure ? "bq-buy-unavailable" : ""}`} key={asset.address}>
                    {failure ? (
                      <span aria-hidden="true" />
                    ) : (
                      <input
                        type="checkbox"
                        className="checkbox checkbox-primary checkbox-sm"
                        aria-label={`Include ${asset.symbol}`}
                        checked={!excluded.includes(asset.address)}
                        disabled={!!busy || !!hash}
                        onChange={event => {
                          setExcluded(previous =>
                            event.target.checked
                              ? previous.filter(address => address !== asset.address)
                              : [...previous, asset.address],
                          );
                          setError("");
                        }}
                      />
                    )}
                    <StockLogo symbol={asset.symbol} size={32} />
                    <span>
                      <strong>{asset.symbol}</strong>
                      <br />
                      {failure ? (
                        <small className="bq-buy-error" title={failure} role="status">
                          Unavailable · excluded
                        </small>
                      ) : leg ? (
                        <>
                          <TokenAmount value={formatUnits(BigInt(leg.sellAmount), leg.sellDecimals)} /> USDG
                        </>
                      ) : null}
                    </span>
                    {!failure && (
                      <span className="text-right">
                        {leg ? <TokenAmount value={formatUnits(BigInt(leg.buyAmount), leg.buyDecimals)} /> : "—"}
                        <br />
                        <small>{excluded.includes(asset.address) ? "Not included" : "After fees"}</small>
                      </span>
                    )}
                  </label>
                );
              })}
          </div>
          {!!failedAssets.length && (
            <div className="bq-batch-failures" role="status">
              <button
                type="button"
                className="btn btn-ghost"
                aria-expanded={showUnavailable}
                onClick={() => setShowUnavailable(value => !value)}
              >
                {failedAssets.length} unavailable · {showUnavailable ? "Hide" : "Show"}
              </button>
              <button
                type="button"
                className="btn btn-ghost w-full"
                disabled={!!busy || !!hash || quotes.isFetching}
                onClick={() => {
                  setRetryVersion(value => value + 1);
                  setExcluded(previous =>
                    previous.filter(token => !failedAssets.some(asset => asset.address === token)),
                  );
                  setError("");
                }}
              >
                Retry
              </button>
            </div>
          )}
          <details>
            <summary>Purchase details</summary>
            <p>
              Slippage 0.5% per stock. ETH is needed for network fees.
              {quote && quote.steps.length > 1 && !atomic
                ? " Stocks routed through LiFi are bought one by one; a failed step does not undo the others."
                : ""}
            </p>
            {quote?.legs.map(leg => (
              <p key={leg.buyToken}>
                {assets.find(asset => asset.address.toLowerCase() === leg.buyToken.toLowerCase())?.symbol}: minimum{" "}
                <TokenAmount value={formatUnits(BigInt(leg.minBuyAmount), leg.buyDecimals)} /> · Basqit fee{" "}
                {leg.basqitFee.bps / 100}% (
                {leg.basqitFee.token.toLowerCase() === leg.buyToken.toLowerCase() ? (
                  <>
                    <TokenAmount value={formatUnits(BigInt(leg.basqitFee.amount), leg.buyDecimals)} />{" "}
                    {assets.find(asset => asset.address.toLowerCase() === leg.buyToken.toLowerCase())?.symbol}
                  </>
                ) : (
                  <>
                    <TokenAmount value={formatUnits(BigInt(leg.basqitFee.amount), leg.sellDecimals)} /> USDG
                  </>
                )}
                ){leg.provider === "lifi" && ` · via LiFi (${leg.route ?? "RFQ"})`}
              </p>
            ))}
          </details>
        </div>
        {quote && (
          <p className="bq-batch-total">
            <span>Total</span>
            <span>
              <TokenAmount value={formatUnits(BigInt(quote.sellAmount), 6)} /> USDG
            </span>
          </p>
        )}
        {!hash && (
          <GasFundingNotice
            required={gasEstimate.data}
            showAction={!gasEstimate.insufficient}
            disabled={!!busy}
            onOpenChange={setFundingOpen}
          />
        )}
        <p className="bq-batch-status" role="alert">
          {error || quotes.error?.message}
        </p>
        {hash ? (
          <>
            <p role="status">Purchase complete.</p>
            <button className="btn btn-primary w-full" onClick={onClose}>
              Dismiss
            </button>
          </>
        ) : !selected.length ? (
          <button className="btn btn-primary w-full" disabled>
            Select at least one stock
          </button>
        ) : !address ? (
          <button className="btn btn-primary w-full" onClick={openConnectModal}>
            Connect wallet
          </button>
        ) : chainId !== robinhoodChain.id ? (
          <button
            className="btn btn-primary w-full"
            onClick={() =>
              void switchChainAsync({ chainId: robinhoodChain.id }).catch(() =>
                setError("Network switch was not completed."),
              )
            }
          >
            Switch network
          </button>
        ) : gasEstimate.insufficient ? (
          <div className="bq-primary-funding">
            <FundingPanel
              destination="ETH"
              triggerLabel="Get ETH to continue"
              disabled={!!busy}
              onOpenChange={setFundingOpen}
            />
          </div>
        ) : (
          <>
            <button className="btn btn-primary w-full" disabled={!usable || !!busy} onClick={() => void execute()}>
              {busy ||
                (quotes.isFetching
                  ? "Calculating all purchases…"
                  : `Buy ${selected.length} ${selected.length === 1 ? "stock" : "stocks"}`)}
            </button>
            {quotes.isError && (
              <button
                className="btn btn-ghost w-full"
                disabled={!!busy || quotes.isFetching}
                onClick={() => void quotes.refetch()}
              >
                Retry quote
              </button>
            )}
            {!atomic && (quote?.steps.length ?? 1) + pendingApprovals.length > 1 && (
              <small className="block mt-2">{quote!.steps.length + pendingApprovals.length} wallet confirmations</small>
            )}
          </>
        )}
      </div>
      {hash && <SwapConfetti key={hash} symbols={assets.filter(isBought).map(asset => asset.symbol)} />}
    </dialog>
  );
}
