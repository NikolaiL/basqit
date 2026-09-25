"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CatalogAsset } from "./AssetCatalog";
import { QuoteDetails } from "./QuoteDetails";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, DocumentDuplicateIcon } from "@heroicons/react/24/outline";
import { Arrow } from "~~/components/Arrow";
import { DialogClose } from "~~/components/DialogClose";
import { StockLogo } from "~~/components/StockLogo";
import { TokenAmount } from "~~/components/TokenAmount";
import type { TradeSelection } from "~~/components/trading/TradeDialog";
import { robinhoodChain } from "~~/services/atlas/client";
import profiles from "~~/services/discover/profiles.json";
import { amount, money } from "~~/services/portfolio/format";

export type DetailAsset = Pick<CatalogAsset, "symbol" | "name" | "address"> &
  Partial<Omit<CatalogAsset, "symbol" | "name" | "address" | "priceAt">> & {
    priceAt?: string | null;
    active?: boolean;
    description?: string;
    website?: string;
    balance?: string;
    shareEquivalent?: string | null;
    valueUsd?: string | null;
  };
function CopyTokenAddress({ address, symbol }: { address: string; symbol: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      clearTimeout(timer.current);
      setError(false);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 3000);
    } catch {
      setError(true);
      setCopied(false);
    }
  }

  return (
    <>
      <div className="bq-token-copy-row">
        <code title={address} aria-label={address}>
          {address.slice(0, 6)}…{address.slice(-4)}
        </code>
        <button
          type="button"
          className={`btn btn-ghost btn-square bq-token-copy ${copied ? "bq-token-copied" : ""}`}
          aria-label={copied ? `${symbol} address copied` : `Copy ${symbol} token address`}
          title={copied ? "Copied" : "Copy address"}
          onClick={() => void copy()}
        >
          {copied ? <CheckIcon key="copied" aria-hidden="true" /> : <DocumentDuplicateIcon aria-hidden="true" />}
        </button>
      </div>
      <span className={error ? "bq-wallet-error" : "sr-only"} role="status">
        {error ? "Could not copy. Select and copy the address manually." : copied ? "Address copied" : ""}
      </span>
    </>
  );
}

export function AssetDetails({
  asset: initialAsset,
  onClose,
  onTrade,
}: {
  asset: DetailAsset;
  onClose: () => void;
  onTrade: (selection: TradeSelection) => void;
}) {
  const metadata = useQuery<CatalogAsset>({
    queryKey: ["asset-details", initialAsset.symbol, initialAsset.address],
    enabled: !initialAsset.sessions || !initialAsset.price,
    staleTime: 60000,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/stocks/asset?symbol=${encodeURIComponent(initialAsset.symbol)}`, { signal });
      if (!response.ok) throw new Error("Asset details unavailable");
      const data = await response.json();
      if (
        data.symbol !== initialAsset.symbol ||
        typeof data.address !== "string" ||
        data.address.toLowerCase() !== initialAsset.address.toLowerCase()
      )
        throw new Error("Asset mismatch");
      return data;
    },
  });
  const asset = { ...initialAsset, ...metadata.data };
  const dialog = useRef<HTMLDialogElement>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const modal = dialog.current;
    modal?.showModal();
    return () => {
      modal?.close();
      trigger?.focus();
    };
  }, []);
  const profile = (profiles as Record<string, { description: string; website: string }>)[asset.symbol];
  const active = asset.status ? asset.status === "Active" : (asset.active ?? true);
  return (
    <dialog ref={dialog} className="modal" aria-labelledby="asset-detail-title" onCancel={onClose}>
      <article className="modal-box bq-asset-detail">
        <DialogClose label="Close stock details" onClick={onClose} />
        <div className="bq-trade-heading">
          <StockLogo symbol={asset.symbol} size={44} />
          <div>
            <h2 id="asset-detail-title">{asset.symbol}</h2>
            <small>{asset.name}</small>
          </div>
        </div>
        {asset.price && (
          <div className="bq-asset-price">
            <span>Reference price / token</span>
            <strong>{money(asset.price)}</strong>
            <small>Indicative, not a sell quote</small>
          </div>
        )}
        {!asset.price && (
          <p className="bq-fine-print" role="status">
            {metadata.isFetching ? "Loading reference price…" : "Reference price unavailable"}
          </p>
        )}
        {asset.balance !== undefined && (
          <div className="bq-asset-price">
            <span>Your holding</span>
            <strong>
              <TokenAmount value={asset.balance} /> tokens
            </strong>
            <small>Reference value: {asset.valueUsd ? money(asset.valueUsd) : "Unavailable"}</small>
          </div>
        )}
        {(asset.description || profile?.description) && <p>{asset.description || profile?.description}</p>}
        <div className="bq-trade-buttons">
          <button className="btn btn-primary" disabled={!active} onClick={() => onTrade({ asset, side: "buy" })}>
            Buy {asset.symbol}
          </button>
          <button className="btn bq-secondary" disabled={!active} onClick={() => onTrade({ asset, side: "sell" })}>
            Sell
          </button>
        </div>
        <details className="bq-swap-details" onToggle={event => setExpanded(event.currentTarget.open)}>
          <summary>Asset details</summary>
          {expanded && <QuoteDetails symbol={asset.symbol} address={asset.address} />}
          {asset.priceAt && (
            <p className="bq-fine-print">
              Reference snapshot: {new Date(asset.priceAt).toLocaleString()}. Not an executable quote.
            </p>
          )}
          <div className="bq-asset-equivalent">
            <span>1 token represents</span>
            <strong title={asset.multiplier ?? undefined}>
              {asset.multiplier ? amount(asset.multiplier, 9) : "Unavailable"}
            </strong>
            <span>underlying shares · adjusts with corporate events</span>
          </div>
          <dl className="bq-asset-metadata">
            <div>
              <dt>Token decimals</dt>
              <dd>{asset.decimals ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>ISIN</dt>
              <dd>{asset.isin || "Not provided"}</dd>
            </div>
          </dl>
          <section className="bq-asset-sessions" aria-label={`${asset.symbol} trading sessions`}>
            <h3>Underlying trading sessions</h3>
            <dl>
              {asset.sessions?.map(session => (
                <div key={session.label}>
                  <dt>{session.label}</dt>
                  <dd>
                    {session.whole === "Available" && session.fractional === "Available" ? (
                      "Whole & fractional · Available"
                    ) : (
                      <>
                        {session.overall && session.overall !== "Not reported" && (
                          <span>Session · {session.overall}</span>
                        )}
                        <span>Whole · {session.whole}</span>
                        <span>Fractional · {session.fractional}</span>
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <small>Exact hours aren’t provided. DEX availability is checked when you request a quote.</small>
          </section>
          <div className="bq-asset-address">
            <span>Token contract</span>
            <CopyTokenAddress address={asset.address} symbol={asset.symbol} />
          </div>

          {asset.shareEquivalent !== undefined && (
            <p>
              Share equivalent: <TokenAmount value={asset.shareEquivalent} />
            </p>
          )}
          <p className="bq-fine-print">
            Catalog status: {asset.status ?? (asset.active === false ? "Inactive" : "Active")}. Trading availability is
            checked with a quote.
          </p>
        </details>
        <div className="bq-asset-links">
          <Link className="link" href={`/corporate-events?token=${encodeURIComponent(asset.symbol)}`}>
            Dividend history <Arrow />
          </Link>
          <a
            className="link"
            href={`${robinhoodChain.blockExplorers.default.url}/token/${asset.address}`}
            target="_blank"
            rel="noreferrer"
          >
            View on explorer <Arrow out />
          </a>
          {(asset.website || profile?.website) && (
            <a className="link" href={asset.website || profile?.website} target="_blank" rel="noreferrer">
              Company / fund <Arrow out />
            </a>
          )}
          <Link className="link" href={`/discover?similar=${encodeURIComponent(asset.symbol)}`}>
            Find similar stocks <Arrow />
          </Link>
        </div>
      </article>
    </dialog>
  );
}
