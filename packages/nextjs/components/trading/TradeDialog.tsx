"use client";

import { useEffect, useRef, useState } from "react";
import { FundingPanel } from "./FundingPanel";
import { GasFundingNotice } from "./GasFundingNotice";
import { SwapConfetti } from "./SwapConfetti";
import { SwapPayPanel } from "./SwapPayPanel";
import { useQueryClient } from "@tanstack/react-query";
import { formatUnits, isAddress, parseUnits } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { Arrow } from "~~/components/Arrow";
import { DialogClose } from "~~/components/DialogClose";
import { TokenAmount } from "~~/components/TokenAmount";
import { useStockTrade, useTradeBalance, useTradeGas } from "~~/hooks/scaffold-eth/useStockTrade";
import { useWalletConnectModal } from "~~/hooks/scaffold-eth/useWalletConnectModal";
import { robinhoodChain } from "~~/services/atlas/client";
import { type QuoteState, watchQuote } from "~~/services/trading/autoQuote";
import { type TradeAsset, USDG, ZEROX_ENABLED, balancePercentage } from "~~/services/trading/quote";

export type TradeSelection = { asset: TradeAsset; side: "buy" | "sell" };

export function TradeDialog({
  selection,
  onClose,
  onSuccess,
}: {
  selection: TradeSelection;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { address, chainId } = useAccount();
  const { openConnectModal, connectModalOpen } = useWalletConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const trade = useStockTrade();
  const queryClient = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const [fundingOpen, setFundingOpen] = useState(false);
  const [side, setSide] = useState(selection.side);
  const [provider, setProvider] = useState<"best" | "0x">("best");
  const [input, setInput] = useState<{ key: string; percentage: number; manual?: string }>();
  const [quoteState, setQuoteState] = useState<QuoteState & { key: string }>({ key: "", loading: false });
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [hash, setHash] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const asset = selection.asset;
  const sellSymbol = side === "buy" ? "USDG" : asset.symbol;
  const buySymbol = side === "buy" ? asset.symbol : "USDG";
  const sellToken = side === "buy" ? USDG : asset.address;
  const balance = useTradeBalance(sellToken, address && isAddress(address) ? (address as `0x${string}`) : undefined);
  const inputKey = `${address ?? ""}:${sellToken}`;
  const currentInput = input?.key === inputKey || input?.key === `:${sellToken}` ? input : undefined;
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
  const validAmount = /^\d{1,40}(\.\d{1,36})?$/.test(amount) && /[1-9]/.test(amount);
  const params = new URLSearchParams({ token: asset.address, taker: address ?? "", side, amount, provider }).toString();
  const canQuote = !!address && chainId === robinhoodChain.id && validAmount && !hash;
  const activeState = quoteState.key === params ? quoteState : undefined;
  const quote = !activeState?.loading && !hash ? activeState?.quote : undefined;
  const loading = canQuote && (!activeState || activeState.loading);

  useEffect(() => {
    if (!canQuote || busy) return;
    return watchQuote(params, state => setQuoteState({ ...state, key: params }));
  }, [params, canQuote, busy, refresh]);

  const currentQuote =
    quote &&
    quote.taker.toLowerCase() === address?.toLowerCase() &&
    chainId === robinhoodChain.id &&
    quote.sellToken.toLowerCase() === sellToken.toLowerCase() &&
    /^\d+(\.\d+)?$/.test(amount) &&
    parseUnits(amount, quote.sellDecimals) === BigInt(quote.sellAmount)
      ? quote
      : undefined;
  const expired = !!currentQuote && now >= currentQuote.expiresAt;
  const gasEstimate = useTradeGas(currentQuote);
  const approval = !!currentQuote && BigInt(currentQuote.allowance) < BigInt(currentQuote.sellAmount);

  useEffect(() => {
    if (connectModalOpen || fundingOpen) dialog.current?.close();
    else dialog.current?.showModal();
  }, [connectModalOpen, fundingOpen]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function run(label: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Transaction failed. Please try again.");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }

  function selectPercentage(value: number) {
    setInput({ key: inputKey, percentage: value });

    setHash(undefined);
    setError("");
  }

  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="trade-title"
      onCancel={e => {
        if ((lock.current || busy) && !hash) e.preventDefault();
        else onClose();
      }}
    >
      <div className="modal-box bq-trade-dialog bq-stock-trade">
        <DialogClose label="Close trade" disabled={!!busy && !hash} onClick={onClose} />
        <button
          type="button"
          className="bq-dialog-refresh"
          aria-label="Refresh quote"
          disabled={!!busy || !canQuote || loading}
          onClick={() => setRefresh(value => value + 1)}
        >
          <ArrowPathIcon aria-hidden="true" />
        </button>
        <div className="bq-trade-heading">
          <div>
            <h2 id="trade-title">
              {side === "buy" ? "Buy" : "Sell"} {asset.symbol}
            </h2>
            <small>Robinhood Chain</small>
          </div>
        </div>
        <div className="bq-trade-body">
          <SwapPayPanel
            symbol={sellSymbol}
            balance={balance.data ? formatUnits(balance.data.balance, balance.data.decimals) : undefined}
            connected={!!address}
            balanceError={balance.isError}
            amount={amount}
            percentage={sliderPercentage}
            disabled={!!busy || !!hash}
            percentageDisabled={!balance.data || !!busy || !!hash}
            loading={loading}
            directionLabel={`Switch to ${side === "buy" ? "selling" : "buying"} ${asset.symbol}`}
            onAmountChange={value => {
              setInput({ key: inputKey, percentage: sliderPercentage, manual: value });
              setHash(undefined);
              setError("");
            }}
            onPercentageChange={selectPercentage}
            onBusy={setBusy}
            onFundingOpenChange={setFundingOpen}
            onFunded={
              side === "buy" && !hash
                ? () => {
                    setRefresh(v => v + 1);
                  }
                : undefined
            }
            onReverse={() => {
              setSide(side === "buy" ? "sell" : "buy");
              setInput(undefined);
              setHash(undefined);
              setError("");
            }}
          />
          <section className="bq-swap-panel" aria-label="You receive">
            <div className="bq-swap-caption">
              <span>You receive</span>
              <span>After fees</span>
            </div>
            <div className="bq-swap-amount-row">
              <strong className="bq-swap-token">{buySymbol}</strong>
              <output
                className="bq-swap-output"
                aria-live="polite"
                aria-busy={loading}
                title={currentQuote ? formatUnits(BigInt(currentQuote.buyAmount), currentQuote.buyDecimals) : undefined}
              >
                {loading ? (
                  "…"
                ) : currentQuote && !expired ? (
                  <TokenAmount value={formatUnits(BigInt(currentQuote.buyAmount), currentQuote.buyDecimals)} />
                ) : (
                  "—"
                )}
              </output>
            </div>
          </section>
          <details className="bq-swap-details">
            <summary>
              {currentQuote ? `Fee ${currentQuote.basqitFee.bps / 100}% · Slippage 0.5%` : "Swap details"}
            </summary>
            <div className="bq-swap-caption bq-swap-status">
              <span>
                {currentQuote?.provider === "lifi"
                  ? `LiFi · ${currentQuote.route ?? "RFQ"}`
                  : currentQuote?.provider === "0x"
                    ? "0x"
                    : "Uniswap v3"}
              </span>
              <span role="status">
                {loading
                  ? "Updating quote…"
                  : currentQuote && !expired
                    ? `Refresh in ${Math.max(0, Math.ceil((currentQuote.expiresAt - now) / 1000))}s`
                    : "Automatic quotes"}
              </span>
            </div>
            {ZEROX_ENABLED && (
              <label className="bq-trade-input">
                Swap provider
                <select
                  className="select select-bordered"
                  value={provider}
                  disabled={!!busy || !!hash}
                  onChange={e => setProvider(e.target.value as "best" | "0x")}
                >
                  <option value="best">Best of Uniswap and LiFi</option>
                  <option value="0x">0x</option>
                </select>
              </label>
            )}
            {currentQuote && (
              <dl className="bq-trade-quote">
                <div>
                  <dt>Minimum received</dt>
                  <dd>
                    <TokenAmount value={formatUnits(BigInt(currentQuote.minBuyAmount), currentQuote.buyDecimals)} />{" "}
                    {buySymbol}
                  </dd>
                </div>
                <div>
                  <dt>Basqit fee · {currentQuote.basqitFee.bps / 100}%</dt>
                  <dd>
                    {currentQuote.basqitFee.token.toLowerCase() === currentQuote.buyToken.toLowerCase() ? (
                      <>
                        <TokenAmount
                          value={formatUnits(BigInt(currentQuote.basqitFee.amount), currentQuote.buyDecimals)}
                        />{" "}
                        {buySymbol}
                      </>
                    ) : (
                      <>
                        <TokenAmount
                          value={formatUnits(BigInt(currentQuote.basqitFee.amount), currentQuote.sellDecimals)}
                        />{" "}
                        {sellSymbol}
                      </>
                    )}
                  </dd>
                </div>
                {currentQuote.providerFee && (
                  <div>
                    <dt>{currentQuote.provider === "lifi" ? "LiFi fee" : "0x fee"}</dt>
                    <dd>
                      <TokenAmount
                        value={formatUnits(
                          BigInt(currentQuote.providerFee.amount),
                          currentQuote.providerFee.token.toLowerCase() === currentQuote.buyToken.toLowerCase()
                            ? currentQuote.buyDecimals
                            : currentQuote.sellDecimals,
                        )}
                      />{" "}
                      {currentQuote.providerFee.token.toLowerCase() === currentQuote.buyToken.toLowerCase()
                        ? buySymbol
                        : sellSymbol}
                    </dd>
                  </div>
                )}
                {currentQuote.impactBps !== undefined && (
                  <div>
                    <dt>Price impact incl. pool fee</dt>
                    <dd>{(currentQuote.impactBps / 100).toFixed(2)}%</dd>
                  </div>
                )}
                {currentQuote.pool && (
                  <div>
                    <dt>Route</dt>
                    <dd>
                      <a
                        className="link"
                        href={`${robinhoodChain.blockExplorers.default.url}/address/${currentQuote.pool}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Uniswap pool <Arrow out />
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            )}
            <p className="bq-fine-print">
              Network fee is paid in ETH and shown in your wallet. Trading uses your connected wallet, not a watched
              address.
              {address && (
                <>
                  {" "}
                  Wallet: {address.slice(0, 6)}…{address.slice(-4)}.
                </>
              )}
            </p>
          </details>
          <div className="bq-swap-errors">
            {activeState?.error && canQuote && (
              <p role="alert" className="bq-wallet-error">
                {activeState.error}
              </p>
            )}
            {error && (
              <p role="alert" className="bq-wallet-error">
                {error}
              </p>
            )}
          </div>
          {hash && (
            <p role="status">
              Swap confirmed.{" "}
              <a
                className="link"
                target="_blank"
                rel="noreferrer"
                href={`${robinhoodChain.blockExplorers.default.url}/tx/${hash}`}
              >
                View transaction <Arrow out />
              </a>
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
        </div>
        <div className="bq-trade-footer">
          {hash ? (
            <button className="btn btn-primary" onClick={onClose}>
              Dismiss
            </button>
          ) : !address ? (
            <button className="btn btn-primary" onClick={openConnectModal}>
              Connect wallet
            </button>
          ) : chainId !== robinhoodChain.id ? (
            <button
              className="btn btn-primary"
              disabled={!!busy || !!hash}
              onClick={() =>
                void run("Switching network…", async () => {
                  await switchChainAsync({ chainId: robinhoodChain.id });
                })
              }
            >
              {busy || "Switch to Robinhood Chain"}
            </button>
          ) : !currentQuote || expired ? (
            <button
              className="btn btn-primary"
              disabled={!!busy || !validAmount || loading || !activeState?.error}
              onClick={() => setRefresh(value => value + 1)}
            >
              {busy ||
                (!validAmount
                  ? "Enter an amount"
                  : loading
                    ? "Finding quote…"
                    : activeState?.error
                      ? "Try again"
                      : "Updating quote…")}
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
          ) : approval ? (
            <button
              className="btn btn-primary"
              disabled={!!busy || !!hash}
              onClick={() =>
                void run("Confirming approval…", async () => {
                  await trade.approve(currentQuote);
                  setRefresh(value => value + 1);
                })
              }
            >
              {busy || `Approve ${sellSymbol}`}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={!!busy || !!hash}
              onClick={() =>
                void run("Confirming swap…", async () => {
                  const result = await trade.swap(currentQuote);
                  setHash(result);
                  onSuccess?.();

                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ["stock-portfolio"] }),
                    queryClient.invalidateQueries({ queryKey: ["trade-balance"] }),
                  ]);
                })
              }
            >
              {busy || `${side === "buy" ? "Buy" : "Sell"} ${asset.symbol}`}
            </button>
          )}
        </div>
        <div className="bq-swap-approval-note" aria-live="polite">
          {approval && !expired && <>Approve {sellSymbol} first, then confirm the swap after the quote refreshes.</>}
        </div>
      </div>
      {hash && <SwapConfetti key={hash} symbols={[buySymbol]} />}
    </dialog>
  );
}
