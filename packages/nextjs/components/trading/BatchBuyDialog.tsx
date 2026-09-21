"use client";

import { useEffect, useRef, useState } from "react";
import { SwapConfetti } from "./SwapConfetti";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatUnits, isAddress } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { StockLogo } from "~~/components/StockLogo";
import { useStockTrade, useTradeBalance } from "~~/hooks/scaffold-eth/useStockTrade";
import { robinhoodChain } from "~~/services/atlas/client";
import type { DiscoveryAsset } from "~~/services/discover/catalog";
import type { BatchQuote } from "~~/services/trading/batch";
import { USDG, balancePercentage } from "~~/services/trading/quote";

export function BatchBuyDialog({ assets, onClose }: { assets: DiscoveryAsset[]; onClose: () => void }) {
  const { address, chainId } = useAccount();
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const trade = useStockTrade();
  const client = useQueryClient();
  const balance = useTradeBalance(USDG, address && isAddress(address) ? (address as `0x${string}`) : undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const selected = assets.filter(asset => !excluded.includes(asset.address));
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
    if (connectModalOpen) dialog.current?.close();
    else dialog.current?.showModal();
  }, [connectModalOpen]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const quotes = useQuery<BatchQuote>({
    queryKey: ["batch-buy", tokens, address, chainId, debounced],
    enabled: ready,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: query =>
      ready && !query.state.error && query.state.data ? Math.max(1000, query.state.data.expiresAt - now) : false,
    queryFn: async ({ signal }): Promise<BatchQuote> => {
      const params = new URLSearchParams({ tokens, taker: address!, amount: debounced });
      const response = await fetch(`/api/swap/batch?${params}`, { signal, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not quote all stocks.");
      return result;
    },
  });
  const quote = amount === debounced ? quotes.data : undefined;
  const approval = quote?.legs.some(leg => BigInt(leg.allowance) < BigInt(quote.sellAmount));
  const usable = ready && !!quote && !quotes.isFetching && !quotes.isError && now < quote.expiresAt;
  async function execute() {
    if (lock.current || !usable || !quote) return;
    lock.current = true;
    setBusy(approval ? "Approving USDG…" : "Buying all stocks…");
    setError("");
    try {
      let executable = quote;
      if (approval) {
        await trade.approve(quote);
        setBusy("Refreshing all quotes…");
        const refreshed = await quotes.refetch();
        if (refreshed.error || !refreshed.data) throw new Error("Approval confirmed. Refresh the quote to continue.");
        executable = refreshed.data;
        if (
          executable.sellAmount !== quote.sellAmount ||
          executable.legs.length !== quote.legs.length ||
          executable.legs.some(
            (leg, i) =>
              leg.buyToken.toLowerCase() !== quote.legs[i].buyToken.toLowerCase() ||
              leg.sellAmount !== quote.legs[i].sellAmount ||
              leg.basqitFee.bps !== quote.legs[i].basqitFee.bps ||
              BigInt(leg.minBuyAmount) < BigInt(quote.legs[i].minBuyAmount),
          )
        )
          throw new Error("Approval confirmed. Prices changed; review the refreshed amounts and press Buy all again.");
      }
      setBusy("Confirm all purchases in your wallet…");
      const confirmed = await trade.swap(executable);
      setHash(confirmed);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["stock-portfolio"] }),
        client.invalidateQueries({ queryKey: ["trade-balance"] }),
      ]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message.split("\n")[0] : "Purchase failed. Please try again.");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={event => {
        event.preventDefault();
        if (!lock.current) onClose();
      }}
    >
      <div className="modal-box bq-batch-buy">
        <div className="bq-discover-detail-heading">
          <h2>Buy these stocks</h2>
          <button className="btn btn-ghost btn-circle" disabled={!!busy} onClick={onClose} aria-label="Close purchase">
            ×
          </button>
        </div>
        <p>
          {selected.length
            ? `One total, split equally across ${selected.length} selected ${selected.length === 1 ? "stock" : "stocks"}.`
            : "Select at least one stock to continue."}
        </p>
        <label className="bq-batch-amount">
          <span>Total USDG</span>
          <input
            aria-label="Total USDG"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            disabled={!!busy || !!hash}
            onChange={event => {
              setInput({ key: inputKey, percentage: sliderPercentage, manual: event.target.value });
              setError("");
            }}
          />
        </label>
        <small>
          Balance:{" "}
          {balance.data
            ? `${formatUnits(balance.data.balance, balance.data.decimals)} USDG`
            : address
              ? "Loading…"
              : "Connect wallet"}
        </small>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          style={{ width: "100%", minHeight: 44, accentColor: "var(--bq-brand)" }}
          aria-label="Percentage of USDG balance"
          aria-valuetext={`${sliderPercentage}%`}
          value={sliderPercentage}
          disabled={!balance.data || !!busy || !!hash}
          onChange={event => choosePercentage(Number(event.target.value))}
        />
        <div className="bq-swap-presets" role="group" aria-label="Balance percentage presets">
          {[0, 25, 50, 75, 100].map(value => (
            <button
              key={value}
              type="button"
              className="btn btn-ghost"
              aria-pressed={sliderPercentage === value}
              disabled={!balance.data || !!busy || !!hash}
              onClick={() => choosePercentage(value)}
            >
              {value}%
            </button>
          ))}
        </div>
        <div className="bq-batch-legs">
          {assets.map(asset => {
            const leg = quote?.legs.find(item => item.buyToken.toLowerCase() === asset.address.toLowerCase());
            return (
              <label className="bq-discover-buy-row" key={asset.address}>
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
                <StockLogo symbol={asset.symbol} size={32} />
                <span>
                  <strong>{asset.symbol}</strong>
                  <br />
                  {leg
                    ? `${formatUnits(BigInt(leg.sellAmount), leg.sellDecimals)} USDG`
                    : excluded.includes(asset.address)
                      ? "—"
                      : "Equal share"}
                </span>
                <span className="text-right">
                  {leg ? formatUnits(BigInt(leg.buyAmount), leg.buyDecimals) : "—"}
                  <br />
                  <small>{excluded.includes(asset.address) ? "Excluded" : `${asset.symbol} after fees`}</small>
                </span>
              </label>
            );
          })}
        </div>
        <details>
          <summary>Purchase details</summary>
          <p>
            All swaps execute in one transaction. If one fails, every swap reverts; network fees may still apply. USDG
            approval is separate when needed.
          </p>
          <p>Slippage: 0.5% per stock. ETH required for network fees.</p>
          {quote?.legs.map((leg, i) => (
            <p key={leg.buyToken}>
              {selected[i].symbol}: minimum {formatUnits(BigInt(leg.minBuyAmount), leg.buyDecimals)} · Basqit fee{" "}
              {leg.basqitFee.bps / 100}% ({formatUnits(BigInt(leg.basqitFee.amount), leg.buyDecimals)}{" "}
              {selected[i].symbol})
            </p>
          ))}
        </details>
        {(error || quotes.error) && <p role="alert">{error || quotes.error?.message}</p>}
        {hash ? (
          <>
            <p role="status">All selected stocks purchased.</p>
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
        ) : (
          <>
            <button className="btn btn-primary w-full" disabled={!usable || !!busy} onClick={() => void execute()}>
              {busy ||
                (quotes.isFetching
                  ? "Calculating all purchases…"
                  : `Buy ${selected.length} ${selected.length === 1 ? "stock" : "stocks"}`)}
            </button>
            {quotes.isError && (
              <button className="btn btn-ghost w-full" onClick={() => void quotes.refetch()}>
                Retry quote
              </button>
            )}
            <small className="block mt-2">
              {approval
                ? "Approve USDG if prompted, then confirm one transaction for all stocks."
                : "One wallet confirmation buys the entire selection."}
            </small>
          </>
        )}
      </div>
      {hash && <SwapConfetti key={hash} symbols={selected.map(asset => asset.symbol)} />}
    </dialog>
  );
}
