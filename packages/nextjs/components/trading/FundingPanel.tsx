"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FundingTokenLogo } from "./FundingTokenLogo";
import { FundingTokenPicker } from "./FundingTokenPicker";
import { RobinhoodBalance } from "./RobinhoodBalance";
import { SwapDivider } from "./SwapDivider";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { formatUnits, isAddress, parseUnits } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { TokenAmount } from "~~/components/TokenAmount";
import { useWalletSession } from "~~/components/WalletAuthentication";
import { tradeTokenAbi } from "~~/contracts/externalContracts";
import { useFundingTransfer } from "~~/hooks/scaffold-eth/useFundingTransfer";
import { useWalletConnectModal } from "~~/hooks/scaffold-eth/useWalletConnectModal";
import { trackFundingResult } from "~~/services/analytics/events";
import { atlasClient } from "~~/services/atlas/client";
import {
  type FundingDestination,
  type FundingQuote,
  type FundingStatus,
  type FundingTransfer,
  NATIVE,
  fundingChains,
  fundingDestinations,
  fundingStatusLabel,
  fundingTokens,
  terminalStatus,
} from "~~/services/funding/shared";
import { type QuoteState, watchQuote } from "~~/services/trading/autoQuote";
import { USDG, balancePercentage } from "~~/services/trading/quote";

async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal, cache: "no-store" }),
    data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Funding unavailable.");
  return data;
}
export function FundingPanel({
  disabled = false,
  destination = "USDG",
  triggerLabel = `Get ${destination}`,
  onBusy,
  onFunded,
  onOpenChange,
}: {
  disabled?: boolean;
  triggerLabel?: string;
  destination?: FundingDestination;
  onBusy?: (busy: string) => void;
  onFunded?: (balance: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const { address, chainId } = useAccount();
  // Remount on account change: a previous wallet's quote or transfer must never become actionable.
  return address && isAddress(address) ? (
    <WalletFunding
      key={`${address.toLowerCase()}:${destination}`}
      address={address as `0x${string}`}
      chainId={chainId}
      disabled={disabled}
      destination={destination}
      triggerLabel={triggerLabel}
      onBusy={onBusy}
      onFunded={onFunded}
      onOpenChange={onOpenChange}
    />
  ) : null;
}
function WalletFunding({
  destination,
  address,
  chainId,
  disabled,
  triggerLabel,
  onBusy,
  onFunded,
  onOpenChange,
}: {
  destination: FundingDestination;
  address: `0x${string}`;
  chainId?: number;
  disabled: boolean;
  triggerLabel: string;
  onBusy?: (busy: string) => void;
  onFunded?: (balance: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const destinationDecimals = fundingDestinations[destination].decimals;
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);
  const [executionQuoteLoading, setQuoteLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerContainer = useRef<HTMLDivElement>(null);
  const pickerTrigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(""),
    [amount, setAmount] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const [quoteState, setQuoteState] = useState<QuoteState<FundingQuote> & { key: string }>({ key: "", loading: false });
  const [refresh, setRefresh] = useState(0);
  const [recoveryHash, setRecoveryHash] = useState("");
  const lock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { openConnectModal, connectModalOpen } = useWalletConnectModal();
  const transfer = useFundingTransfer(),
    queryClient = useQueryClient(),
    { switchChainAsync } = useSwitchChain();
  const storageKey = `basqit-funding-v1:${address.toLowerCase()}${destination === "ETH" ? ":ETH" : ""}`;
  const saved = useQuery<FundingTransfer | null>({
    queryKey: [storageKey],
    queryFn: async () => {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (
        data.wallet?.toLowerCase() !== address.toLowerCase() ||
        !fundingChains.some(c => c.id === data.chainId) ||
        !/^0x[0-9a-f]{1,128}$/i.test(data.quoteId) ||
        (data.hash && !/^0x[0-9a-f]{64}$/i.test(data.hash))
      )
        throw new Error("Saved transfer is invalid. Check your wallet history before continuing.");
      return data;
    },
    staleTime: Infinity,
    retry: false,
  });
  const pending = saved.data;
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  // A saved intent protects against duplicate sends; it is not a recovery case while the wallet is responding.
  const showDialog = open && !(pending && !pending.hash && busy);
  useEffect(() => {
    if (showDialog && !connectModalOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [showDialog, connectModalOpen]);
  function save(value: FundingTransfer | null) {
    if (value) localStorage.setItem(storageKey, JSON.stringify(value));
    else {
      const previous = localStorage.getItem(storageKey);
      if (previous) {
        const archiveKey = `${storageKey}:history`;
        const history = JSON.parse(localStorage.getItem(archiveKey) ?? "[]");
        localStorage.setItem(archiveKey, JSON.stringify([...history.slice(-19), JSON.parse(previous)]));
      }
      localStorage.removeItem(storageKey);
    }
    queryClient.setQueryData([storageKey], value);
  }
  const { authenticated } = useWalletSession();
  const scans = useInfiniteQuery({
    queryKey: ["funding-balances-v2", address],
    enabled: open && !pending && authenticated,
    initialPageParam: "",
    queryFn: ({ signal, pageParam }) =>
      read<{ tokens: unknown[]; incomplete: boolean; nextPageKey: string | null; warning?: string | null }>(
        `/api/funding/balances?${new URLSearchParams({ address, ...(pageParam ? { pageKey: pageParam } : {}) })}`,
        signal,
      ),
    getNextPageParam: (page, _pages, _param, pageParams) =>
      page.nextPageKey && !pageParams.includes(page.nextPageKey) ? page.nextPageKey : undefined,
    staleTime: 60000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const { hasNextPage, isFetching, isError, fetchNextPage } = scans;
  const loadingTokens = scans.isFetching || (open && authenticated && !pending && !!hasNextPage && !isError);
  const pageCount = scans.data?.pages.length ?? 0;
  useEffect(() => {
    if (open && !pending && authenticated && hasNextPage && !isFetching && !isError) void fetchNextPage();
  }, [open, pending, authenticated, hasNextPage, isFetching, isError, pageCount, fetchNextPage]);
  const tokens = fundingTokens(scans.data?.pages.flatMap(page => page.tokens) ?? []);
  const suggestedEth = tokens.find(t => t.address.toLowerCase() === NATIVE);
  const suggestedEthKey = suggestedEth ? `${suggestedEth.chainId}:${suggestedEth.address}` : "";
  useEffect(() => {
    if (destination === "ETH" && !selected && !loadingTokens && suggestedEthKey) setSelected(suggestedEthKey);
  }, [destination, selected, loadingTokens, suggestedEthKey]);
  const token = tokens.find(t => `${t.chainId}:${t.address}` === selected);
  const nativeSource = token?.address.toLowerCase() === NATIVE;
  const validAmount =
    !!token && /^\d{1,40}(\.\d{1,36})?$/.test(amount) && (amount.split(".")[1]?.length ?? 0) <= token.decimals;
  const units = validAmount ? parseUnits(amount, token!.decimals) : 0n;
  const spendingAllEth = !!token && nativeSource && units >= BigInt(token.balance);
  const canQuote =
    open &&
    authenticated &&
    !pending &&
    !disabled &&
    !!token &&
    units > 0n &&
    units <= BigInt(token.balance) &&
    !spendingAllEth;
  const params = new URLSearchParams({
    destination,
    wallet: address,
    chainId: String(token?.chainId ?? ""),
    token: token?.address ?? "",
    amount: units.toString(),
  }).toString();
  const activeState = quoteState.key === params ? quoteState : undefined;
  const quote = canQuote ? activeState?.quote : undefined;
  const quoteLoading = executionQuoteLoading || (canQuote && (!activeState || activeState.loading));
  useEffect(() => {
    if (!canQuote || busy) return;
    return watchQuote<FundingQuote>(params, state => setQuoteState({ ...state, key: params }), "/api/funding/quote");
  }, [canQuote, params, busy, refresh]);
  useEffect(() => {
    if (!pickerOpen) return;
    function dismiss(event: PointerEvent) {
      if (!pickerContainer.current?.contains(event.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [pickerOpen]);
  const status = useQuery<FundingStatus>({
    queryKey: ["funding-status", pending?.chainId, pending?.hash, pending?.quoteId],
    enabled: open && !!pending?.hash,
    queryFn: ({ signal }) =>
      read(
        `/api/funding/status?${new URLSearchParams({ originChain: String(pending!.chainId), originTxHash: pending!.hash!, quoteId: pending!.quoteId })}`,
        signal,
      ),
    retry: false,
    refetchInterval: q => (terminalStatus(q.state.data) ? false : 10000),
  });
  useEffect(() => {
    if (pending?.hash && status.data?.status)
      trackFundingResult(pending.hash, destination, pending.chainId, status.data.status);
  }, [pending?.hash, pending?.chainId, destination, status.data?.status]);
  useEffect(() => {
    if (status.data?.status === "bridge_filled") void queryClient.invalidateQueries({ queryKey: ["trade-balance"] });
  }, [status.data?.status, queryClient]);
  async function run(label: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    onBusy?.(label);
    setError("");
    try {
      if (!navigator.locks) throw new Error("This browser cannot safely coordinate transfers. Use a current browser.");
      await navigator.locks.request(storageKey, { ifAvailable: true }, async held => {
        if (!held) throw new Error("Funding is active in another tab.");
        await action();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Funding failed.");
    } finally {
      lock.current = false;
      setBusy("");
      onBusy?.("");
    }
  }
  async function getQuote() {
    if (!token || !/^\d+(\.\d+)?$/.test(amount) || (amount.split(".")[1]?.length ?? 0) > token.decimals)
      throw new Error("Enter a valid source amount.");
    const units = parseUnits(amount, token.decimals);
    if (token.address.toLowerCase() === NATIVE && units >= BigInt(token.balance))
      throw new Error("Keep some ETH on the source network for transaction fees.");
    if (units <= 0n || units > BigInt(token.balance)) throw new Error("Amount exceeds your available balance.");
    setQuoteLoading(true);
    try {
      const q = await read<FundingQuote>(
        `/api/funding/quote?${new URLSearchParams({ destination, wallet: address, chainId: String(token.chainId), token: token.address, amount: units.toString() })}`,
      );
      setQuoteState({ key: params, loading: false, quote: q });
      return q;
    } finally {
      setQuoteLoading(false);
    }
  }
  async function finish() {
    const gas = await atlasClient.getBalance({ address });
    const balance =
      destination === "ETH"
        ? gas
        : await atlasClient.readContract({
            address: USDG,
            abi: tradeTokenAbi,
            functionName: "balanceOf",
            args: [address],
          });
    if (onFunded || onOpenChange) await switchChainAsync({ chainId: 4663 });
    await queryClient.invalidateQueries({ queryKey: ["trade-balance"] });
    onFunded?.(formatUnits(destination === "ETH" ? gas : balance, destinationDecimals));
    save(null);
    setOpen(false);
  }
  const sliderPercentage = token
    ? Math.min(
        100,
        Math.max(
          0,
          Math.round((Number(amount || 0) / Number(formatUnits(BigInt(token.balance), token.decimals))) * 100) || 0,
        ),
      )
    : 50;
  function choosePercentage(value: number) {
    if (!token || (nativeSource && value === 100)) return;
    setAmount(balancePercentage(BigInt(token.balance), token.decimals, value, 8));
    setError("");
  }
  const source = fundingChains.find(c => c.id === pending?.chainId);
  const blocked = disabled || !!busy;
  return (
    <section className="bq-funding">
      <button
        type="button"
        className="btn btn-ghost w-full"
        disabled={blocked}
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {pending ? `View ${destination} transfer` : triggerLabel}
      </button>
      {showDialog &&
        createPortal(
          <dialog
            ref={dialog}
            className="modal"
            aria-labelledby={titleId}
            onCancel={e => {
              e.preventDefault();
              e.stopPropagation();
              if (!lock.current) setOpen(false);
            }}
            onClose={e => {
              e.stopPropagation();
              if (!connectModalOpen) setOpen(false);
            }}
          >
            <div className="modal-box bq-trade-dialog bq-converter">
              {onOpenChange && (
                <button
                  type="button"
                  className="btn btn-ghost bq-back-to-purchase"
                  disabled={!!busy}
                  onClick={() => setOpen(false)}
                >
                  ← Back to purchase
                </button>
              )}
              <div className="bq-trade-heading">
                <div>
                  <h2 id={titleId}>{pending ? `${destination} transfer` : `Get ${destination}`}</h2>
                  <small>
                    {pending
                      ? "Track your transfer"
                      : destination === "ETH"
                        ? "You need ETH on Robinhood Chain for stock purchases. Suggested top-up: $1–2 of ETH. Choose your amount; network fees vary."
                        : "You need USDG to buy stock tokens on Robinhood Chain."}
                  </small>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-square"
                  aria-label="Close converter"
                  disabled={!!busy}
                  onClick={() => setOpen(false)}
                >
                  ✕
                </button>
              </div>
              <div className="bq-converter-balance">
                <span>Available on Robinhood</span>
                <RobinhoodBalance address={address} asset={destination} />
              </div>
              <div className="bq-funding-content">
                {saved.isError && <p role="alert">{saved.error.message}</p>}
                {pending ? (
                  <>
                    <p role="status" className="bq-converter-progress">
                      {!pending.hash
                        ? "Check your wallet"
                        : status.isError
                          ? "Status unavailable — your transfer is still saved."
                          : fundingStatusLabel(status.data, destination)}
                    </p>
                    {pending.hash && (
                      <a
                        className="link"
                        target="_blank"
                        rel="noreferrer"
                        href={`${source?.blockExplorers.default.url}/tx/${pending.hash}`}
                      >
                        View transaction ↗
                      </a>
                    )}
                    {status.data?.failure && (
                      <p role="alert">
                        Recovery: {status.data.failure.status.replaceAll("_", " ")}.{" "}
                        {status.data.failure.recovery && (
                          <>
                            Token {status.data.failure.recovery.token} on chain {status.data.failure.recovery.chainId}.
                            Refunds can use a different token.
                          </>
                        )}{" "}
                        {status.data.zid && <>Reference: {status.data.zid}.</>}
                      </p>
                    )}
                    {!pending.hash && (
                      <>
                        <p className="bq-fine-print">
                          Check your wallet history before retrying. If sent, paste the transaction hash to resume
                          tracking.
                        </p>
                        <input
                          className="input input-bordered w-full"
                          aria-label="Submitted funding transaction hash"
                          value={recoveryHash}
                          onChange={e => setRecoveryHash(e.target.value)}
                          placeholder="0x…"
                        />
                        <button
                          className="btn btn-secondary"
                          disabled={!/^0x[0-9a-f]{64}$/i.test(recoveryHash) || blocked}
                          onClick={() => save({ ...pending, hash: recoveryHash as `0x${string}` })}
                        >
                          Track transaction
                        </button>
                        <button
                          className="btn btn-ghost"
                          disabled={blocked}
                          onClick={() => {
                            if (window.confirm("I checked my wallet history and this transfer was not submitted."))
                              save(null);
                          }}
                        >
                          I did not submit it
                        </button>
                      </>
                    )}
                    {status.data?.status === "bridge_filled" && (
                      <>
                        <p>
                          {onFunded || onOpenChange
                            ? `${destination} delivered. Continue with your available balance and a fresh stock quote.`
                            : `${destination} delivered to your wallet on Robinhood Chain.`}
                        </p>
                        <button
                          className="btn btn-primary w-full"
                          disabled={blocked}
                          onClick={() => void run(`Updating ${destination} balance…`, finish)}
                        >
                          {busy || (onFunded || onOpenChange ? "Continue to stock purchase" : "Done")}
                        </button>
                        <button
                          className="btn btn-ghost w-full"
                          disabled={blocked}
                          onClick={() => {
                            save(null);
                            setOpen(true);
                            void queryClient.invalidateQueries({ queryKey: ["funding-balances-v2", address] });
                          }}
                        >
                          Convert another token
                        </button>
                      </>
                    )}
                    {terminalStatus(status.data) && status.data?.status !== "bridge_filled" && (
                      <>
                        <a className="link" href="https://help.0x.org/" target="_blank" rel="noreferrer">
                          Contact 0x support ↗
                        </a>
                        <button className="btn btn-ghost w-full" disabled={blocked} onClick={() => save(null)}>
                          Dismiss completed transfer
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <section className="bq-converter-pay" aria-label="You pay">
                      <div className="bq-swap-caption">
                        <span>You pay</span>
                        {token && (
                          <span>
                            Balance: <TokenAmount value={formatUnits(BigInt(token.balance), token.decimals)} />{" "}
                            {token.symbol}
                          </span>
                        )}
                      </div>
                      <div
                        className="bq-token-picker-anchor"
                        ref={pickerContainer}
                        onBlur={event => {
                          if (!event.currentTarget.contains(event.relatedTarget)) setPickerOpen(false);
                        }}
                      >
                        <button
                          type="button"
                          className="btn btn-ghost bq-token-trigger"
                          ref={pickerTrigger}
                          disabled={blocked}
                          aria-expanded={pickerOpen}
                          aria-busy={loadingTokens}
                          onClick={() => setPickerOpen(value => !value)}
                        >
                          {token && <FundingTokenLogo token={token} />}
                          <span>
                            {token ? (
                              <>
                                <strong>{token.symbol}</strong>
                                <small>
                                  {fundingChains.find(c => c.id === token.chainId)?.name}
                                  {destination === "ETH" && selected === suggestedEthKey ? " · Suggested" : ""}
                                </small>
                              </>
                            ) : (
                              "Choose a token"
                            )}
                          </span>
                          <span className="bq-token-trigger-status">
                            {loadingTokens ? (
                              <span role="status">
                                <span className="loading loading-spinner loading-xs" aria-hidden="true" />
                                <span className="sr-only">Loading wallet tokens…</span>
                              </span>
                            ) : (
                              <span aria-hidden="true">⌄</span>
                            )}
                          </span>
                        </button>
                        {pickerOpen && (
                          <FundingTokenPicker
                            tokens={tokens}
                            selected={selected}
                            loading={loadingTokens}
                            error={scans.error?.message}
                            onRetry={() => void scans.refetch()}
                            onClose={() => {
                              setPickerOpen(false);
                              pickerTrigger.current?.focus();
                            }}
                            onSelect={t => {
                              setSelected(`${t.chainId}:${t.address}`);
                              setError("");
                              setAmount(
                                destination === "ETH" ? "" : balancePercentage(BigInt(t.balance), t.decimals, 50, 8),
                              );
                              setPickerOpen(false);
                              pickerTrigger.current?.focus();
                            }}
                          />
                        )}
                      </div>
                      <div className="bq-swap-amount-row">
                        <strong className="bq-swap-token">{token?.symbol ?? "Amount"}</strong>
                        <input
                          className="input bq-swap-amount"
                          inputMode="decimal"
                          aria-label="Funding amount"
                          placeholder="0.00"
                          autoComplete="off"
                          value={amount}
                          disabled={blocked || !token}
                          onChange={e => {
                            setAmount(e.target.value);
                            setError("");
                          }}
                        />
                      </div>
                      <input
                        type="range"
                        min="0"
                        max={nativeSource ? 99 : 100}
                        step="1"
                        style={{ width: "100%", minHeight: 44, accentColor: "var(--bq-brand)" }}
                        aria-label={`Percentage of ${token?.symbol ?? "token"} balance`}
                        aria-valuetext={`${sliderPercentage}%`}
                        value={sliderPercentage}
                        disabled={blocked || !token}
                        onChange={event => choosePercentage(Number(event.target.value))}
                      />
                      <div className="bq-swap-presets" role="group" aria-label="Conversion balance percentage presets">
                        {[25, 50, 75, 100].map(p => (
                          <button
                            key={p}
                            className="btn btn-ghost"
                            disabled={blocked || !token || (nativeSource && p === 100)}
                            title={nativeSource && p === 100 ? "Keep ETH for network fees" : undefined}
                            type="button"
                            aria-pressed={!!token && sliderPercentage === p}
                            onClick={() => choosePercentage(p)}
                          >
                            {p}%
                          </button>
                        ))}
                      </div>
                    </section>
                    <div className="bq-converter-scan" aria-live="polite">
                      {!authenticated && (
                        <button type="button" className="btn btn-link btn-sm" onClick={openConnectModal}>
                          Sign in to load your tokens
                        </button>
                      )}
                      {scans.isError && (
                        <>
                          <span>{scans.error.message}</span>
                          <button
                            className="btn btn-link btn-sm"
                            disabled={blocked || scans.isFetching}
                            onClick={() => void scans.refetch()}
                          >
                            Retry
                          </button>
                        </>
                      )}
                      {!scans.hasNextPage && scans.data?.pages.some(page => page.warning) && (
                        <span>Some networks could not be checked.</span>
                      )}
                      {scans.data && !scans.isFetching && !tokens.length && (
                        <span>No eligible balances found on Ethereum, Base, Arbitrum or Optimism.</span>
                      )}
                    </div>
                    <SwapDivider loading={quoteLoading} directionLabel={`Convert to ${destination}`} />
                    <section className="bq-converter-receive" aria-label="You receive">
                      <div className="bq-swap-caption">
                        <span>You receive</span>
                        <span>Robinhood Chain</span>
                      </div>
                      <div className="bq-swap-amount-row">
                        <strong className="bq-swap-token">{destination}</strong>
                        <output className="bq-swap-output" aria-live="polite">
                          {quote ? (
                            <>
                              ~<TokenAmount value={formatUnits(BigInt(quote.buyAmount), destinationDecimals)} />
                            </>
                          ) : (
                            "—"
                          )}
                        </output>
                      </div>
                      <small>
                        {quote ? (
                          <>
                            Minimum <TokenAmount value={formatUnits(BigInt(quote.minBuyAmount), destinationDecimals)} />{" "}
                            {destination} · About {quote.seconds}s
                          </>
                        ) : quoteLoading ? (
                          "Updating amount…"
                        ) : (
                          "Enter an amount to see how much you’ll receive."
                        )}
                      </small>
                    </section>
                    {token && (
                      <details className="bq-converter-details">
                        <summary>Conversion details</summary>
                        <dl>
                          <div>
                            <dt>From</dt>
                            <dd>{fundingChains.find(c => c.id === token.chainId)?.name}</dd>
                          </div>
                          <div>
                            <dt>Token contract</dt>
                            <dd>{token.address}</dd>
                          </div>
                          <div>
                            <dt>To</dt>
                            <dd>{destination} · Robinhood Chain</dd>
                          </div>
                          {quote && (
                            <div>
                              <dt>Basqit fee ({quote.basqitFee.bps / 100}%)</dt>
                              <dd>
                                <TokenAmount value={formatUnits(BigInt(quote.basqitFee.amount), token.decimals)} />{" "}
                                {token.symbol}
                              </dd>
                            </div>
                          )}
                          {quote && (
                            <div>
                              <dt>Route</dt>
                              <dd>{quote.provider.replaceAll("_", " ")}</dd>
                            </div>
                          )}
                        </dl>
                        <p>
                          This conversion sends {destination} to your connected wallet. Stock purchases are a separate
                          step.
                        </p>
                      </details>
                    )}
                    <p className="bq-converter-note">
                      {nativeSource ? (
                        <>
                          Keep ETH on {fundingChains.find(c => c.id === token?.chainId)?.name} for future fees. You
                          won’t be able to transact there without it. Gas is reserved before sending.
                        </>
                      ) : (
                        <>
                          {quote ? "Basqit and provider fees are included in the estimate. " : ""}Network fees are paid
                          separately in ETH on the source network.{" "}
                          {destination === "USDG"
                            ? "Keep ETH on Robinhood Chain for stock purchases."
                            : "No ETH is needed on Robinhood Chain to receive this transfer."}
                        </>
                      )}
                    </p>
                    <div className="bq-swap-errors" role="alert">
                      {error ||
                        (spendingAllEth
                          ? "You cannot transfer all your ETH. Leave some on the source network for transaction fees."
                          : "") ||
                        (canQuote
                          ? activeState?.error
                          : token && amount && units > BigInt(token.balance)
                            ? "Amount exceeds your available balance."
                            : "")}
                    </div>
                    <div className="bq-funding-footer">
                      <button
                        className="btn btn-primary w-full"
                        disabled={
                          blocked ||
                          spendingAllEth ||
                          quoteLoading ||
                          !token ||
                          (!quote && !activeState?.error) ||
                          !saved.isSuccess ||
                          !!saved.error
                        }
                        onClick={() =>
                          void run("Confirm in your wallet…", async () => {
                            if (!quote) {
                              setRefresh(value => value + 1);
                              return;
                            }
                            if (chainId !== quote.chainId) {
                              await transfer.switchSource(quote.chainId);
                              return;
                            }
                            await transfer.approve(quote);
                            const fresh = await getQuote();
                            if (
                              fresh.destination !== destination ||
                              quote.destination !== destination ||
                              fresh.wallet.toLowerCase() !== quote.wallet.toLowerCase() ||
                              fresh.token.toLowerCase() !== quote.token.toLowerCase() ||
                              fresh.chainId !== quote.chainId ||
                              fresh.sellAmount !== quote.sellAmount ||
                              fresh.basqitFee.bps !== quote.basqitFee.bps ||
                              fresh.basqitFee.recipient?.toLowerCase() !== quote.basqitFee.recipient?.toLowerCase() ||
                              fresh.spender?.toLowerCase() !== quote.spender?.toLowerCase() ||
                              BigInt(fresh.minBuyAmount) < BigInt(quote.minBuyAmount)
                            )
                              throw new Error("Quote changed. Review the new amount and confirm again.");
                            const record: FundingTransfer = {
                              wallet: address,
                              chainId: fresh.chainId,
                              quoteId: fresh.quoteId,
                              createdAt: Date.now(),
                            };
                            await transfer.send(
                              fresh,
                              () => {
                                if (localStorage.getItem(storageKey)) throw new Error("A transfer is already pending.");
                                save(record);
                              },
                              hash => save({ ...record, hash }),
                              () => save(null),
                            );
                          })
                        }
                      >
                        {busy ||
                          (quoteLoading
                            ? "Finding route…"
                            : !token
                              ? "Choose a token to continue"
                              : !quote
                                ? activeState?.error
                                  ? "Try again"
                                  : spendingAllEth
                                    ? "Leave ETH for network fees"
                                    : "Enter an amount"
                                : chainId !== quote.chainId
                                  ? `Switch to ${fundingChains.find(c => c.id === quote.chainId)?.name}`
                                  : `Convert to ${destination}`)}
                      </button>
                      <p className="bq-converter-note bq-converter-next">
                        {quote
                          ? "Your wallet may ask for token approval before the transfer."
                          : "Review the amount and fees before confirming in your wallet."}
                      </p>
                    </div>
                  </>
                )}
                {pending && (
                  <div className="bq-swap-errors" role="alert">
                    {error}
                  </div>
                )}
              </div>
            </div>
          </dialog>,
          document.body,
        )}
    </section>
  );
}
