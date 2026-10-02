"use client";

import { useEffect, useRef, useState } from "react";
import { demoError, formatToken } from "./usePacks";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { DialogClose } from "~~/components/DialogClose";
import { TokenAmount } from "~~/components/TokenAmount";
import { SwapPayPanel } from "~~/components/trading/SwapPayPanel";
import { useHeightTransition } from "~~/components/trading/useHeightTransition";
import { useWalletConnectModal } from "~~/hooks/scaffold-eth/useWalletConnectModal";
import { explorerTx, robinhoodTestnet } from "~~/services/packs/testnet";
import { balancePercentage } from "~~/services/trading/quote";

const ONE = 10n ** 18n;

export type BasketTrade = {
  symbol: string;
  name: string;
  /** tUSDG (6 decimals) for one share at today's prices. */
  perShare: bigint;
  /** Creator fee charged on this trade, 0 when fees are off. */
  feeBps: bigint;
  shares: bigint;
};

/**
 * The stock trade dialog for a basket on testnet: buy with an amount of tUSDG, sell an amount of shares.
 * Amounts received are estimates at today's prices; the routers enforce the exact budget and minimum.
 */
export function BasketTradeDialog({
  basket,
  initialSide,
  usdg,
  onBuy,
  onSell,
  onClose,
}: {
  basket: BasketTrade;
  initialSide: "buy" | "sell";
  usdg?: bigint;
  onBuy: (usdgIn: bigint) => Promise<string | undefined>;
  onSell: (shares: bigint) => Promise<string | undefined>;
  onClose: () => void;
}) {
  const { address, chainId } = useAccount();
  const { openConnectModal } = useWalletConnectModal();
  const { switchChainAsync } = useSwitchChain();
  const dialog = useRef<HTMLDialogElement>(null);
  const [side, setSide] = useState(initialSide);
  const [input, setInput] = useState<{ percentage: number; manual?: string }>({ percentage: 50 });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // The confirmed trade's hash; "confirmed" when the wallet returned none.
  const [done, setDone] = useState("");
  const { ref: shrinkRef, note: noteHeight } = useHeightTransition<HTMLDivElement>(done);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const buying = side === "buy";
  const paySymbol = buying ? "tUSDG" : basket.symbol;
  const receiveSymbol = buying ? basket.symbol : "tUSDG";
  const decimals = buying ? 6 : 18;
  const balance = buying ? usdg : basket.shares;
  const amount =
    input.manual ?? (balance !== undefined ? balancePercentage(balance, decimals, input.percentage, 6) : "");
  let pay = 0n;
  try {
    pay = parseUnits(amount.trim() || "0", decimals);
  } catch {}
  const fee = (value: bigint) => (value * basket.feeBps + 9_999n) / 10_000n;
  // Buy: what is left after the fee buys whole components at today's price. Sell: the fee comes off the proceeds.
  const receive = buying
    ? basket.perShare > 0n
      ? (pay * 10_000n * ONE) / ((10_000n + basket.feeBps) * basket.perShare)
      : 0n
    : (pay * basket.perShare) / ONE - fee((pay * basket.perShare) / ONE);
  const tooMuch = balance !== undefined && pay > balance;
  const sliderPercentage =
    input.manual === undefined || !balance
      ? input.percentage
      : Math.min(100, Math.max(0, Math.round(Number((pay * 100n) / balance))));

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(demoError(failure));
    } finally {
      setBusy("");
    }
  };

  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="basket-trade-title"
      onCancel={event => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <div className="modal-box bq-trade-dialog bq-stock-trade" ref={shrinkRef}>
        <DialogClose label="Close trade" disabled={!!busy} onClick={onClose} />
        <div className="bq-trade-heading">
          <div>
            <h2 id="basket-trade-title">
              {buying ? "Buy" : "Sell"} {basket.name}
            </h2>
            <small>Robinhood Chain testnet · Test tokens only</small>
          </div>
        </div>
        {!done && (
          <div className="bq-trade-body">
            <SwapPayPanel
              symbol={paySymbol}
              balance={balance !== undefined ? formatUnits(balance, decimals) : undefined}
              connected={!!address}
              balanceError={false}
              amount={amount}
              percentage={sliderPercentage}
              disabled={!!busy || !!done}
              percentageDisabled={balance === undefined || !!busy || !!done}
              loading={false}
              directionLabel={`Switch to ${buying ? "selling" : "buying"} ${basket.symbol}`}
              onAmountChange={value => {
                setInput({ percentage: sliderPercentage, manual: value });
                setError("");
              }}
              onPercentageChange={percentage => {
                setInput({ percentage });
                setError("");
              }}
              onBusy={setBusy}
              onReverse={() => {
                setSide(buying ? "sell" : "buy");
                setInput({ percentage: 50 });
                setError("");
                setDone("");
              }}
            />
            <section className="bq-swap-panel" aria-label="You receive">
              <div className="bq-swap-caption">
                <span>You receive</span>
                <span>About, after fees</span>
              </div>
              <div className="bq-swap-amount-row">
                <strong className="bq-swap-token">{receiveSymbol}</strong>
                <output className="bq-swap-output" aria-live="polite">
                  {receive > 0n ? <TokenAmount value={formatUnits(receive, buying ? 18 : 6)} /> : "—"}
                </output>
              </div>
            </section>
            <p className="bq-fine-print">
              One share is {formatToken(basket.perShare, 6)} tUSDG today
              {basket.feeBps > 0n && `, plus a ${Number(basket.feeBps) / 100}% creator fee`}.{" "}
              {buying
                ? "Your tUSDG buys every company in the basket; anything not spent comes back to you."
                : "Your shares are redeemed and every company in them is sold for tUSDG."}
            </p>
            {buying && usdg === 0n && <p className="bq-fine-print">You have no tUSDG yet. Get free test USDG above.</p>}
            {error && (
              <p role="alert" className="bq-wallet-error">
                {error}
              </p>
            )}
          </div>
        )}
        {done && (
          <div className="bq-batch-done">
            <p role="status">Completed</p>
            {done !== "confirmed" && (
              <a href={explorerTx(done)} target="_blank" rel="noreferrer">
                View transaction
              </a>
            )}
          </div>
        )}
        <div className="bq-trade-footer">
          {done ? (
            <button className="btn btn-primary" onClick={onClose}>
              Dismiss
            </button>
          ) : !address ? (
            <button className="btn btn-primary" onClick={openConnectModal}>
              Connect wallet
            </button>
          ) : chainId !== robinhoodTestnet.id ? (
            <button
              className="btn btn-primary"
              disabled={!!busy}
              onClick={() => run("Switching network…", () => switchChainAsync({ chainId: robinhoodTestnet.id }))}
            >
              {busy || "Switch to Robinhood Chain Testnet"}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={!!busy || pay === 0n || receive === 0n || tooMuch}
              onClick={() =>
                run(buying ? "Buying…" : "Selling…", async () => {
                  const hash = await (buying ? onBuy(pay) : onSell(pay));
                  noteHeight();
                  setDone(hash ?? "confirmed");
                })
              }
            >
              {busy ||
                (pay === 0n
                  ? "Enter an amount"
                  : tooMuch
                    ? `Not enough ${paySymbol}`
                    : `${buying ? "Buy" : "Sell"} ${basket.symbol}`)}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
