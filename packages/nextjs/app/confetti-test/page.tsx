"use client";

import { useRef, useState } from "react";
import { SwapConfetti } from "~~/components/trading/SwapConfetti";
import { notification } from "~~/utils/scaffold-eth";

const toasts = [
  ["Success", () => notification.success("Bought 8 Stock Tokens.")],
  ["Info", () => notification.info("Quotes refresh every 30 seconds.")],
  ["Warning", () => notification.warning("The price moved by more than 0.5%.")],
  ["Error", () => notification.error("Purchase failed. Please try again.")],
  ["Loading", () => notification.loading("Waiting for the wallet…")],
] as const;

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
      <h2 className="mt-8 text-xl font-bold">Notifications</h2>
      <p className="text-sm opacity-70">Each button shows one toast; loading stays until dismissed.</p>
      <div className="flex flex-wrap gap-2">
        {toasts.map(([label, show]) => (
          <button key={label} className="btn btn-sm" onClick={show}>
            {label}
          </button>
        ))}
      </div>
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
