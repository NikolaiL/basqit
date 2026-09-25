"use client";

import { useId, useState } from "react";
import type { WaitlistProduct } from "~~/services/waitlist/waitlist";

export function WaitlistForm({ product, cta }: { product: WaitlistProduct; cta: string }) {
  const id = useId();
  const [state, setState] = useState<{ status: "idle" | "sending" | "done" | "error"; message?: string }>({
    status: "idle",
  });
  if (state.status === "done")
    return (
      <p className="bq-waitlist-done" role="status">
        You’re on the list. We’ll email you when it opens.
      </p>
    );
  return (
    <form
      className="bq-waitlist"
      onSubmit={async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setState({ status: "sending" });
        const response = await fetch("/api/waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.get("email"), website: form.get("website"), product }),
        }).catch(() => null);
        const body = await response?.json().catch(() => null);
        if (response?.ok) setState({ status: "done" });
        else setState({ status: "error", message: body?.error ?? "Could not save your email. Try again." });
      }}
    >
      <label htmlFor={`${id}-email`}>{cta}</label>
      <div className="bq-waitlist-row">
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="input"
        />
        <button className="btn btn-primary" disabled={state.status === "sending"}>
          {state.status === "sending" ? "Joining…" : "Join the list"}
        </button>
      </div>
      {/* Honeypot for bots; hidden from people and assistive tech. */}
      <input name="website" tabIndex={-1} autoComplete="off" className="bq-waitlist-trap" aria-hidden="true" />
      <p className="bq-waitlist-note" role={state.status === "error" ? "alert" : undefined}>
        {state.status === "error" ? state.message : "Only launch news about Basqit. Unsubscribe any time."}
      </p>
    </form>
  );
}
