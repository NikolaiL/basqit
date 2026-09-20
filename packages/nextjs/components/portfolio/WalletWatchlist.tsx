"use client";

import { useEffect, useState } from "react";
import { AddressInput } from "@scaffold-ui/components";
import { getAddress, isAddress } from "viem";
import { type SavedWallet, WATCHLIST_KEY, parseWallets, saveWallet } from "~~/services/portfolio/watchlist";

export function WalletWatchlist({
  selected,
  connected,
  onSelect,
}: {
  selected?: string;
  connected?: string;
  onSelect: (address?: `0x${string}`) => void;
}) {
  const [wallets, setWallets] = useState<SavedWallet[]>([]);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const valid = isAddress(input.trim());
  const existing = wallets.some(w => w.address.toLowerCase() === input.trim().toLowerCase());

  useEffect(() => {
    const read = () => {
      try {
        setWallets(parseWallets(localStorage.getItem(WATCHLIST_KEY)));
        setError("");
      } catch {
        setError("Saved wallets could not be loaded. You can still look up an address.");
      }
      setReady(true);
    };
    read();
    const sync = (event: StorageEvent) => {
      if (event.key === WATCHLIST_KEY || event.key === null) read();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const persist = (next: SavedWallet[]) => {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
      setWallets(next);
      setError("");
      return true;
    } catch {
      setError("This browser could not save your wallets. You can still use View once.");
      return false;
    }
  };

  return (
    <section className="bq-watch card" aria-labelledby="wallets-title">
      <div className="bq-watch-heading">
        <div>
          <h2 id="wallets-title">Watch wallets</h2>
          <p>Save several wallets or look up any address. No connection needed.</p>
        </div>
        {selected && (
          <button className="btn btn-sm btn-ghost" onClick={() => onSelect(undefined)}>
            {connected ? "Use connected wallet" : "Clear viewed wallet"}
          </button>
        )}
      </div>
      <form
        onSubmit={e => {
          e.preventDefault();
          if (valid) {
            onSelect(getAddress(input.trim()) as `0x${string}`);
            setMessage("Viewing this address without saving changes.");
          }
        }}
      >
        <label className="bq-address-field">
          <span className="sr-only">Wallet address</span>
          <AddressInput value={input} onChange={setInput} placeholder="Wallet address" />
        </label>
        <input
          className="input bq-wallet-name"
          aria-label="Wallet name (optional)"
          placeholder="Name (optional)"
          value={name}
          maxLength={40}
          onChange={e => setName(e.target.value)}
        />
        <button
          className="btn btn-primary"
          type="button"
          disabled={!valid || !ready}
          onClick={() => {
            if (valid && persist(saveWallet(wallets, input, name))) {
              onSelect(getAddress(input.trim()) as `0x${string}`);
              setMessage(existing ? "Saved wallet updated." : "Wallet saved in this browser.");
              setInput("");
              setName("");
            }
          }}
        >
          {existing ? "Update & view" : "Save & watch"}
        </button>
        <button className="btn btn-ghost" type="submit" disabled={!valid}>
          View once
        </button>
      </form>
      {input.trim() && !valid && <p className="bq-fine-print">Enter a valid wallet address to continue.</p>}
      <p className="bq-watch-note">Saved only in this browser. Select a wallet to view its balances and events.</p>
      {error && (
        <p role="alert" className="bq-wallet-error">
          {error}
        </p>
      )}
      <p role="status" className="bq-watch-note">
        {message}
      </p>
      {wallets.length > 0 && (
        <ul className="bq-wallet-list" aria-label="Saved wallets">
          {wallets.map(wallet => (
            <li key={wallet.address}>
              <button
                type="button"
                className="bq-wallet-choice"
                aria-pressed={selected?.toLowerCase() === wallet.address.toLowerCase()}
                onClick={() => {
                  onSelect(wallet.address);
                  setMessage("");
                }}
              >
                <strong>{wallet.name || "Unnamed wallet"}</strong>
                <span>
                  {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
                </span>
              </button>
              <button
                className="btn btn-sm btn-ghost"
                aria-label={`Edit ${wallet.name || wallet.address}`}
                onClick={() => {
                  setInput(wallet.address);
                  setName(wallet.name);
                  setMessage("");
                }}
              >
                Edit
              </button>
              <button
                className="btn btn-sm btn-ghost"
                aria-label={`Remove ${wallet.name || wallet.address}`}
                onClick={() => {
                  if (persist(wallets.filter(w => w.address !== wallet.address)))
                    setMessage("Removed from saved wallets. The current view is unchanged.");
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
