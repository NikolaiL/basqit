"use client";

import { FundingPanel } from "./FundingPanel";
import { SwapDivider } from "./SwapDivider";
import { TokenAmount } from "~~/components/TokenAmount";
import { useWalletConnectModal } from "~~/hooks/scaffold-eth/useWalletConnectModal";

type SwapPayPanelProps = {
  symbol: string;
  balance?: string;
  connected: boolean;
  balanceError: boolean;
  amount: string;
  percentage: number;
  disabled: boolean;
  percentageDisabled: boolean;
  loading: boolean;
  directionLabel: string;
  onAmountChange: (value: string) => void;
  onPercentageChange: (value: number) => void;
  onBusy: (value: string) => void;
  onFunded?: (value: string) => void;
  onReverse?: () => void;
};

export function SwapPayPanel({
  symbol,
  balance,
  connected,
  balanceError,
  amount,
  percentage,
  disabled,
  percentageDisabled,
  loading,
  directionLabel,
  onAmountChange,
  onPercentageChange,
  onBusy,
  onFunded,
  onReverse,
}: SwapPayPanelProps) {
  const { openConnectModal } = useWalletConnectModal();
  return (
    <>
      <section className="bq-swap-panel" aria-label="You pay">
        <div className="bq-swap-caption">
          <span>You pay</span>
          <div className="bq-swap-balance">
            <span title={balance}>
              {!connected ? (
                <button
                  type="button"
                  className="link link-primary"
                  onClick={openConnectModal}
                  disabled={!openConnectModal}
                >
                  Connect wallet
                </button>
              ) : balanceError ? (
                "Balance unavailable"
              ) : balance !== undefined ? (
                <>
                  Balance: <TokenAmount value={balance} /> {symbol}
                </>
              ) : (
                "Loading balance…"
              )}
            </span>
            {onFunded && (
              <FundingPanel triggerLabel="Get More" disabled={disabled} onBusy={onBusy} onFunded={onFunded} />
            )}
          </div>
        </div>
        <div className="bq-swap-amount-row">
          <strong className="bq-swap-token">{symbol}</strong>
          <input
            aria-label={`You pay (${symbol})`}
            className="input bq-swap-amount"
            inputMode="decimal"
            placeholder="0.00"
            autoComplete="off"
            value={amount}
            disabled={disabled}
            onChange={event => onAmountChange(event.target.value)}
          />
        </div>
        <input
          type="range"
          style={{ width: "100%", minHeight: 44, accentColor: "var(--bq-brand)" }}
          min={0}
          max={100}
          step={1}
          value={percentage}
          aria-label={`Percentage of ${symbol} balance`}
          aria-valuetext={`${percentage}%`}
          disabled={percentageDisabled}
          onChange={event => onPercentageChange(Number(event.target.value))}
        />
        <div className="bq-swap-presets" role="group" aria-label="Balance percentage presets">
          {[0, 25, 50, 75, 100].map(value => (
            <button
              key={value}
              type="button"
              className="btn btn-ghost"
              aria-pressed={percentage === value}
              disabled={percentageDisabled}
              onClick={() => onPercentageChange(value)}
            >
              {value}%
            </button>
          ))}
        </div>
      </section>
      <SwapDivider loading={loading} directionLabel={directionLabel} disabled={disabled} onReverse={onReverse} />
    </>
  );
}
