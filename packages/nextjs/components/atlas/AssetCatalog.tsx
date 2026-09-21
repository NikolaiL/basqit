"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { QuoteDetails } from "./QuoteDetails";
import { CheckIcon, DocumentDuplicateIcon } from "@heroicons/react/24/outline";
import { robinhoodChain } from "~~/services/atlas/client";
import { amount, money } from "~~/services/portfolio/format";

export type CatalogAsset = {
  symbol: string;
  name: string;
  address: `0x${string}`;
  multiplier: string | null;
  decimals: number | null;
  isin: string | null;
  status: string;
  price?: string | null;
  priceAt?: string;
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

export function AssetCatalog({ assets }: { assets: CatalogAsset[] }) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visible = assets.filter(asset =>
    `${asset.symbol} ${asset.name} ${asset.address} ${asset.isin ?? ""}`.toLowerCase().includes(query),
  );
  return (
    <>
      <div className="bq-catalog-toolbar">
        <label>
          <span className="sr-only">Search tokens</span>
          <input
            className="input input-bordered"
            type="search"
            placeholder="Search by name, symbol or address"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </label>
        <span role="status">
          {visible.length} of {assets.length} tokens
        </span>
      </div>
      <div className="bq-catalog-grid">
        {visible.map(asset => (
          <article key={asset.address} className="card bq-asset-card">
            <div className="bq-asset-heading">
              <span className="bq-asset-mark" aria-hidden="true">
                {asset.symbol.slice(0, 2)}
              </span>
              <div>
                <h2>{asset.symbol}</h2>
                <p>{asset.name}</p>
              </div>
              <span className="badge badge-outline">{asset.status}</span>
            </div>
            <div className="bq-asset-price">
              <span>Reference price / token</span>
              <strong>{asset.price ? money(asset.price) : "—"}</strong>
              <QuoteDetails symbol={asset.symbol} address={asset.address} />
              {asset.priceAt && (
                <small>
                  Quote generated{" "}
                  {new Date(asset.priceAt).toLocaleString("en-GB", {
                    timeZone: "UTC",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  UTC
                </small>
              )}
            </div>
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
            <div className="bq-asset-address">
              <span>Token contract</span>
              <CopyTokenAddress address={asset.address} symbol={asset.symbol} />
            </div>
            <div className="bq-asset-links">
              <a
                className="link"
                href={`${robinhoodChain.blockExplorers.default.url}/token/${asset.address}`}
                target="_blank"
                rel="noreferrer"
              >
                View on explorer ↗
              </a>
              <Link className="link" href={`/corporate-events?token=${encodeURIComponent(asset.symbol)}`}>
                Dividend history →
              </Link>
            </div>
          </article>
        ))}
      </div>
      {!visible.length && (
        <div className="bq-empty">
          <h2>No matching tokens</h2>
          <p>Try another name, symbol or contract address.</p>
        </div>
      )}
      <p className="bq-data-note">
        Issuer catalog · cached up to 5 minutes. Reference prices use underlying bid/ask midpoint × multiplier, not an
        executable quote. Quote generation time does not establish market freshness. Active is the asset’s catalog
        status, not confirmation that trading is open.
      </p>
    </>
  );
}
