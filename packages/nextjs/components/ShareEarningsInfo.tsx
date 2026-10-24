"use client";

import { useId, useRef } from "react";
import { DialogClose } from "~~/components/DialogClose";

export function ShareEarningsInfo() {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button type="button" className="link bq-share-earnings" onClick={() => dialog.current?.showModal()}>
        Earn with each share
      </button>
      <dialog ref={dialog} className="modal" aria-labelledby={titleId}>
        <div className="modal-box bq-fee-info">
          <DialogClose label="Close" onClick={() => dialog.current?.close()} />
          <h2 id={titleId} className="text-lg font-bold">
            Share the link, we share the fees
          </h2>
          <p>
            Connect your wallet before sharing so your link can credit you. Sharing alone does not earn a reward; a
            qualifying trade must follow.
          </p>
          <ul className="list-disc space-y-2 pl-5 py-3">
            <li>Your link carries your wallet address.</li>
            <li>
              When someone opens it and buys or sells stocks on Basqit, you get half of the Basqit fee on that trade.
              The fee is shown before every trade.
            </li>
            <li>They pay the same fee either way.</li>
            <li>Your share goes to your wallet in the same onchain transaction. Nothing to claim.</li>
            <li>The last link they opened counts. Your own trades don&apos;t.</li>
            <li>For now this covers stock trades only.</li>
          </ul>
          <button className="btn btn-primary btn-sm" onClick={() => dialog.current?.close()}>
            Got it
          </button>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>Close</button>
        </form>
      </dialog>
    </>
  );
}
