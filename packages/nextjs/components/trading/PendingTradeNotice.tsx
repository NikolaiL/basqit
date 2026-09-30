"use client";

import { useState } from "react";
import { Arrow } from "~~/components/Arrow";
import type { usePendingTrade } from "~~/hooks/scaffold-eth/useStockTrade";
import { robinhoodChain } from "~~/services/atlas/client";

/**
 * Blocks a new trade while an earlier one from this wallet has no known outcome, with funding's recovery steps, and
 * says plainly how a resolved one ended. Every unresolved state has a manual way out, including a hash that was
 * replaced (sped up or cancelled) or dropped and will never get a receipt.
 */
export function PendingTradeNotice({ pending }: { pending: ReturnType<typeof usePendingTrade> }) {
  const [hash, setHash] = useState("");
  const trade = pending.data;
  // Two different answers from wallet history, recorded differently: nothing bought, or the purchase went through.
  const answers = (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          if (window.confirm("I checked my wallet history: this purchase was not sent, or it was cancelled."))
            pending.resolve(false);
        }}
      >
        Nothing was bought
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          if (window.confirm("I checked my wallet history: this purchase went through and shows in my balance."))
            pending.resolve(true);
        }}
      >
        The purchase went through
      </button>
    </>
  );
  if (!trade && pending.isError)
    return (
      <div className="bq-fine-print" role="alert">
        <p>The saved record of an earlier trade could not be read. Check your wallet history before trading again.</p>
        {answers}
      </div>
    );
  if (!trade)
    return pending.resolved ? (
      <p className="bq-fine-print" role="status">
        {pending.resolved.outcome === "success"
          ? "Your earlier trade confirmed; it is in your balance."
          : "Your earlier trade failed on chain, so nothing was bought."}
      </p>
    ) : null;
  return (
    <div className="bq-fine-print" role="status">
      <p>
        {trade.outcome === "replaced"
          ? "Your wallet replaced or dropped the earlier trade: its transaction will not confirm, but a sped-up copy may have. Check your wallet history, then track the replacement or say what happened."
          : trade.outcome === "unverified"
            ? "The transaction you entered confirmed, but it is not this purchase (a different wallet, contract or call), for example a cancellation. Check your wallet history and say what happened."
            : "An earlier trade from this wallet is still unresolved, so new trades are paused until it confirms or fails. This checks automatically."}
      </p>
      {trade.ref && trade.kind === "tx" && (
        <a
          className="link"
          target="_blank"
          rel="noreferrer"
          href={`${robinhoodChain.blockExplorers.default.url}/tx/${trade.ref}`}
        >
          View transaction <Arrow out />
        </a>
      )}
      {trade.ref && trade.kind === "calls" && (
        <p>
          Submitted as one wallet batch. Reference: <code className="break-all">{trade.ref}</code>
        </p>
      )}
      <p>
        {trade.ref
          ? "If your wallet shows a different transaction for this trade, paste its hash to track that one instead."
          : "Check your wallet history. If it was sent, paste the transaction hash to track it."}
      </p>
      <input
        className="input input-bordered input-sm w-full"
        aria-label="Transaction hash from your wallet history"
        value={hash}
        onChange={e => setHash(e.target.value)}
        placeholder="0x…"
      />
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={!/^0x[0-9a-f]{64}$/i.test(hash) || hash.toLowerCase() === trade.ref?.toLowerCase()}
        onClick={() => {
          pending.track(hash as `0x${string}`);
          setHash("");
        }}
      >
        Track transaction
      </button>
      {answers}
    </div>
  );
}
