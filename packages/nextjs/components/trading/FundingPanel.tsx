"use client";

import { useEffect, useId, useRef, useState } from "react";
import { USDGBalance } from "./USDGBalance";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { formatUnits, isAddress, parseUnits } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { TokenAmount } from "~~/components/TokenAmount";
import { tradeTokenAbi } from "~~/contracts/externalContracts";
import { useFundingTransfer } from "~~/hooks/scaffold-eth/useFundingTransfer";
import { atlasClient } from "~~/services/atlas/client";
import {
  type FundingQuote,
  type FundingStatus,
  type FundingTransfer,
  fundingChains,
  fundingTokens,
  terminalStatus,
} from "~~/services/funding/shared";
import { USDG, balancePercentage } from "~~/services/trading/quote";

async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal, cache: "no-store" }),
    data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Funding unavailable.");
  return data;
}
export function FundingPanel({
  disabled = false,
  onBusy,
  onFunded,
}: {
  disabled?: boolean;
  onBusy?: (busy: string) => void;
  onFunded?: (balance: string) => void;
}) {
  const { address, chainId } = useAccount();
  // Remount on account change: a previous wallet's quote or transfer must never become actionable.
  return address && isAddress(address) ? (
    <WalletFunding
      key={address.toLowerCase()}
      address={address as `0x${string}`}
      chainId={chainId}
      disabled={disabled}
      onBusy={onBusy}
      onFunded={onFunded}
    />
  ) : null;
}
function WalletFunding({
  address,
  chainId,
  disabled,
  onBusy,
  onFunded,
}: {
  address: `0x${string}`;
  chainId?: number;
  disabled: boolean;
  onBusy?: (busy: string) => void;
  onFunded?: (balance: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(""),
    [amount, setAmount] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const [quote, setQuote] = useState<FundingQuote>(),
    [recoveryHash, setRecoveryHash] = useState("");
  const lock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const transfer = useFundingTransfer(),
    queryClient = useQueryClient(),
    { switchChainAsync } = useSwitchChain();
  const storageKey = `basqit-funding-v1:${address.toLowerCase()}`;
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
  const scans = useInfiniteQuery({
    queryKey: ["funding-balances-v2", address],
    enabled: open && !pending,
    initialPageParam: "",
    queryFn: ({ signal, pageParam }) =>
      read<{ tokens: unknown[]; incomplete: boolean; nextPageKey: string | null; warning?: string | null }>(
        `/api/funding/balances?${new URLSearchParams({ address, ...(pageParam ? { pageKey: pageParam } : {}) })}`,
        signal,
      ),
    getNextPageParam: page => page.nextPageKey ?? undefined,
    staleTime: 60000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const { hasNextPage, isFetching, isError, fetchNextPage } = scans;
  const pageCount = scans.data?.pages.length ?? 0;
  useEffect(() => {
    // ponytail: auto-load at most five pages; deeper wallets continue explicitly, under the same upstream budget.
    if (open && !pending && hasNextPage && !isFetching && !isError && pageCount < 5) void fetchNextPage();
  }, [open, pending, hasNextPage, isFetching, isError, pageCount, fetchNextPage]);
  const tokens = fundingTokens(scans.data?.pages.flatMap(page => page.tokens) ?? []);
  const token = tokens.find(t => `${t.chainId}:${t.address}` === selected);
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
    if (units <= 0n || units > BigInt(token.balance)) throw new Error("Amount exceeds your available balance.");
    const q = await read<FundingQuote>(
      `/api/funding/quote?${new URLSearchParams({ wallet: address, chainId: String(token.chainId), token: token.address, amount: units.toString() })}`,
    );
    setQuote(q);
    return q;
  }
  async function finish() {
    const [balance, gas] = await Promise.all([
      atlasClient.readContract({ address: USDG, abi: tradeTokenAbi, functionName: "balanceOf", args: [address] }),
      atlasClient.getBalance({ address }),
    ]);
    if (onFunded && gas === 0n)
      throw new Error("USDG has arrived. Add ETH on Robinhood Chain for the stock purchase, then continue.");
    if (onFunded) await switchChainAsync({ chainId: 4663 });
    await queryClient.invalidateQueries({ queryKey: ["trade-balance"] });
    onFunded?.(formatUnits(balance, 6));
    save(null);
    setOpen(false);
    setQuote(undefined);
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
    if (!token) return;
    setAmount(balancePercentage(BigInt(token.balance), token.decimals, value));
    setQuote(undefined);
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
        {pending ? "View USDG transfer" : "Convert to USDG"}
      </button>
      {open &&
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
              setOpen(false);
            }}
          >
            <div className="modal-box bq-trade-dialog">
              <div className="bq-trade-heading">
                <div>
                  <h2 id={titleId}>Convert to USDG</h2>
                  <small>On Robinhood Chain</small>
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
              <USDGBalance address={address} />
              <div className="bq-funding-content">
                <p className="bq-fine-print">
                  Convert crypto to USDG on Robinhood Chain. Add one source asset at a time. Transfers and stock
                  purchases are separate transactions.
                </p>
                {saved.isError && <p role="alert">{saved.error.message}</p>}
                {pending ? (
                  <>
                    <p role="status">
                      {!pending.hash
                        ? "Submission needs checking"
                        : status.isError
                          ? "Status unavailable — your transfer is still saved."
                          : (status.data?.status ?? "Checking transfer").replaceAll("_", " ")}
                    </p>
                    {pending.hash && (
                      <a
                        className="link"
                        target="_blank"
                        rel="noreferrer"
                        href={`${source?.blockExplorers.default.url}/tx/${pending.hash}`}
                      >
                        View source transaction ↗
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
                          {onFunded
                            ? "USDG delivered. Continue with your available balance and a fresh stock quote."
                            : "USDG delivered to your wallet on Robinhood Chain."}
                        </p>
                        <button
                          className="btn btn-primary w-full"
                          disabled={blocked}
                          onClick={() => void run("Updating USDG balance…", finish)}
                        >
                          {busy || (onFunded ? "Continue to stock purchase" : "Done")}
                        </button>
                        <button
                          className="btn btn-ghost w-full"
                          disabled={blocked}
                          onClick={() => {
                            save(null);
                            setQuote(undefined);
                            setOpen(true);
                            void queryClient.invalidateQueries({ queryKey: ["funding-balances-v2", address] });
                          }}
                        >
                          Add another source asset
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
                    {scans.isFetching && <p role="status">Finding wallet balances…</p>}
                    {scans.isError && (
                      <>
                        <p role="alert">{scans.error.message}</p>
                        <button className="btn btn-ghost" disabled={blocked} onClick={() => void scans.refetch()}>
                          Retry scan
                        </button>
                      </>
                    )}
                    {(scans.hasNextPage || scans.data?.pages.some(page => page.warning)) && (
                      <p className="bq-fine-print">
                        {scans.hasNextPage
                          ? "More wallet assets are available."
                          : "Some wallet data may be unavailable."}
                      </p>
                    )}
                    {scans.hasNextPage && (
                      <button
                        className="btn btn-ghost"
                        disabled={blocked || scans.isFetching}
                        onClick={() => void scans.fetchNextPage()}
                      >
                        Load more wallet assets
                      </button>
                    )}
                    {scans.data && !scans.isFetching && !tokens.length && (
                      <p>No priced balances found on Ethereum, Base, Arbitrum or Optimism.</p>
                    )}
                    <label className="bq-trade-input">
                      Pay with
                      <select
                        className="select select-bordered w-full"
                        value={selected}
                        disabled={blocked}
                        onChange={e => {
                          setSelected(e.target.value);
                          setQuote(undefined);
                          const t = tokens.find(t => `${t.chainId}:${t.address}` === e.target.value);
                          setAmount(t ? balancePercentage(BigInt(t.balance), t.decimals, 50) : "");
                        }}
                      >
                        <option value="">Select an asset</option>
                        {tokens.map(t => (
                          <option key={`${t.chainId}:${t.address}`} value={`${t.chainId}:${t.address}`}>
                            {t.symbol} · {fundingChains.find(c => c.id === t.chainId)?.name} · ~${t.usd.toFixed(2)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {token && (
                      <>
                        <small className="block break-all">
                          {token.address} · Balance{" "}
                          <TokenAmount value={formatUnits(BigInt(token.balance), token.decimals)} />
                        </small>
                        <label className="bq-batch-amount">
                          <span>{token.symbol}</span>
                          <input
                            inputMode="decimal"
                            aria-label="Funding amount"
                            value={amount}
                            disabled={blocked}
                            onChange={e => {
                              setAmount(e.target.value);
                              setQuote(undefined);
                            }}
                          />
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          style={{ width: "100%", minHeight: 44, accentColor: "var(--bq-brand)" }}
                          aria-label={`Percentage of ${token.symbol} balance`}
                          aria-valuetext={`${sliderPercentage}%`}
                          value={sliderPercentage}
                          disabled={blocked}
                          onChange={event => choosePercentage(Number(event.target.value))}
                        />
                        <div
                          className="bq-swap-presets"
                          role="group"
                          aria-label="Conversion balance percentage presets"
                        >
                          {[0, 25, 50, 75, 100].map(p => (
                            <button
                              key={p}
                              className="btn btn-ghost"
                              disabled={blocked}
                              type="button"
                              aria-pressed={sliderPercentage === p}
                              onClick={() => choosePercentage(p)}
                            >
                              {p}%
                            </button>
                          ))}
                        </div>
                        <button
                          className="btn btn-secondary w-full"
                          disabled={blocked || !saved.isSuccess || !!saved.error}
                          onClick={() =>
                            void run("Finding funding route…", async () => {
                              await getQuote();
                            })
                          }
                        >
                          {busy || "Get funding quote"}
                        </button>
                      </>
                    )}
                    {quote && token && (
                      <>
                        <p>
                          <strong>
                            ~<TokenAmount value={formatUnits(BigInt(quote.buyAmount), 6)} /> USDG
                          </strong>{" "}
                          on Robinhood
                        </p>
                        <small>
                          Minimum <TokenAmount value={formatUnits(BigInt(quote.minBuyAmount), 6)} /> USDG ·{" "}
                          {quote.provider} · estimated {quote.seconds}s. Output includes provider fees; ETH for gas is
                          additional.
                        </small>
                        <p className="bq-fine-print">
                          You also need ETH on Robinhood for the later stock purchase. Funding does not buy stocks
                          automatically.
                        </p>
                        <button
                          className="btn btn-primary w-full"
                          disabled={blocked}
                          onClick={() =>
                            void run("Confirm funding in your wallet…", async () => {
                              if (chainId !== quote.chainId) {
                                await transfer.switchSource(quote.chainId);
                                return;
                              }
                              await transfer.approve(quote);
                              const fresh = await getQuote();
                              if (
                                fresh.wallet.toLowerCase() !== quote.wallet.toLowerCase() ||
                                fresh.token.toLowerCase() !== quote.token.toLowerCase() ||
                                fresh.chainId !== quote.chainId ||
                                fresh.sellAmount !== quote.sellAmount ||
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
                                  if (localStorage.getItem(storageKey))
                                    throw new Error("A transfer is already pending.");
                                  save(record);
                                },
                                hash => save({ ...record, hash }),
                              );
                            })
                          }
                        >
                          {busy ||
                            (chainId !== quote.chainId
                              ? `Switch to ${fundingChains.find(c => c.id === quote.chainId)?.name}`
                              : "Approve & fund USDG")}
                        </button>
                      </>
                    )}
                  </>
                )}
                {error && <p role="alert">{error}</p>}
              </div>
            </div>
          </dialog>,
          document.body,
        )}
    </section>
  );
}
