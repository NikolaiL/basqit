"use client";

import { useState } from "react";
import { FundingTokenLogo } from "./FundingTokenLogo";
import { formatUnits } from "viem";
import { LoadingBars } from "~~/components/LoadingBars";
import { TokenAmount } from "~~/components/TokenAmount";
import { type FundingToken, fundingChains } from "~~/services/funding/shared";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function FundingTokenPicker({
  tokens,
  selected,
  loading,
  error,
  onRetry,
  onSelect,
  onClose,
}: {
  tokens: FundingToken[];
  selected: string;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onSelect: (token: FundingToken) => void;
  onClose: () => void;
}) {
  const [network, setNetwork] = useState<number | null>(null);
  const visible = tokens.filter(token => network === null || token.chainId === network);
  return (
    <div
      className="bq-token-picker-panel"
      role="region"
      aria-label="Choose a token"
      aria-busy={loading}
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="bq-token-networks" role="group" aria-label="Filter tokens by network">
        <button
          type="button"
          className="btn btn-ghost"
          aria-pressed={network === null}
          onClick={() => setNetwork(null)}
        >
          All
        </button>
        {fundingChains.map(chain => (
          <button
            type="button"
            key={chain.id}
            className="btn btn-ghost"
            aria-pressed={network === chain.id}
            onClick={() => setNetwork(chain.id)}
          >
            {chain.name.replace(" One", "").replace("OP Mainnet", "Optimism")}
          </button>
        ))}
      </div>
      <div className="bq-token-results">
        <div className="bq-token-list-heading">
          <h3>My tokens</h3>
          <small className="bq-token-list-status">
            <span className={loading ? "" : "invisible"}>
              <LoadingBars small />
            </span>
            {visible.length}
            <span className="sr-only">{loading ? " tokens loaded; loading more" : " tokens"}</span>
          </small>
        </div>
        <div className="bq-token-list" aria-label="Wallet tokens">
          {visible.map(token => (
            <button
              type="button"
              className="bq-token-row"
              key={`${token.chainId}:${token.address}`}
              aria-pressed={selected === `${token.chainId}:${token.address}`}
              onClick={() => onSelect(token)}
            >
              <FundingTokenLogo token={token} />
              <span className="bq-token-identity">
                <strong>{token.name || token.symbol}</strong>
                <small>
                  {token.symbol} <span>· {fundingChains.find(chain => chain.id === token.chainId)?.name}</span>
                </small>
              </span>
              <span className="bq-token-holding">
                <span>
                  <TokenAmount value={formatUnits(BigInt(token.balance), token.decimals)} /> {token.symbol}
                </span>
                <small>{dollars.format(token.usd)}</small>
              </span>
            </button>
          ))}
        </div>
        {!visible.length && !loading && (
          <p className="bq-token-empty" role="status">
            No eligible tokens found.
          </p>
        )}
        {error && (
          <div className="bq-token-empty" role="status">
            {error}
            <button className="btn btn-link" disabled={loading} onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
