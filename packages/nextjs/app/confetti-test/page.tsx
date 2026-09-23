"use client";

import { useRef, useState } from "react";
import { SwapConfetti } from "~~/components/trading/SwapConfetti";

export default function ConfettiTestPage() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [run, setRun] = useState(0);
  const [open, setOpen] = useState(false);
  return (
    <main className="mx-auto w-full max-w-lg p-6">
      <h1 className="text-3xl font-bold">Token confetti</h1>
      <p>
        Preview the swap celebration with Apple and NVIDIA logos, plus the fallback logo. No wallet or transaction
        needed.
      </p>
      <p className="text-sm opacity-70">Animation respects your device’s reduced-motion setting.</p>
      <button
        className="btn btn-primary"
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
          setRun(value => value + 1);
        }}
      >
        Test token confetti
      </button>
      <dialog ref={dialog} className="modal" aria-labelledby="confetti-title" onClose={() => setOpen(false)}>
        <div className="modal-box">
          <h2 id="confetti-title" className="text-2xl font-bold">
            Swap confirmed
          </h2>
          <p>This is a preview of the success animation.</p>
          <div className="modal-action">
            <button className="btn" onClick={() => setRun(value => value + 1)}>
              Replay
            </button>
            <button className="btn btn-primary" onClick={() => dialog.current?.close()}>
              Dismiss
            </button>
          </div>
        </div>
        {open && <SwapConfetti key={run} symbols={["AAPL", "NVDA", "USDG"]} />}
      </dialog>
    </main>
  );
}
