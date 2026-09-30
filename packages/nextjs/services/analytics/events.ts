import { BaseError } from "viem";

// Off unless the environment sets an ID: local and preview builds send nothing by default.
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID?.trim() ?? "";
type Parameters = Record<string, string | number | boolean | undefined>;
declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}
let initialized = false;
export function initializeAnalytics() {
  if (typeof window === "undefined" || initialized || !GA_ID) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function () {
      // eslint-disable-next-line prefer-rest-params -- Keep the Google tag command queue format.
      window.dataLayer.push(arguments);
    };
  window.gtag("js", new Date());
  window.gtag("config", GA_ID);
  initialized = true;
}
export function trackEvent(name: string, parameters: Parameters = {}) {
  try {
    initializeAnalytics();
    if (typeof window !== "undefined") window.gtag?.("event", name, parameters);
  } catch {
    // Analytics must never interrupt wallet actions or navigation.
  }
}
/** Typed themes can hold anything a person writes, so only their rough length leaves the browser. */
export function discoveryShape(text: string) {
  const length = Array.from(text.trim()).length;
  return { discovery_length: length === 0 ? "0" : length <= 20 ? "1-20" : length <= 60 ? "21-60" : "61+" };
}
export function trackDiscovery(action: string, text: string, parameters: Parameters = {}) {
  trackEvent(`discovery_${action}`, { ...parameters, ...discoveryShape(text) });
}

// One event per swap leg; a shared attempt ID groups an atomic stock purchase.
export async function trackSwap<T>(legs: Parameters[], execute: (submitted: () => void) => Promise<T>): Promise<T> {
  const attemptId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let sent = false;
  const emit = (stage: string) =>
    legs.forEach((leg, index) =>
      trackEvent(`swap_${stage}`, {
        ...leg,
        attempt_id: attemptId,
        leg_index: index,
        token_count: legs.length,
      }),
    );
  emit("started");
  try {
    const result = await execute(() => {
      sent = true;
      emit("submitted");
    });
    if (sent) emit(legs[0]?.swap_type === "funding" ? "origin_confirmed" : "confirmed");
    else emit("not_submitted");
    return result;
  } catch (error) {
    const cause =
      error instanceof BaseError
        ? error.walk(e => !!e && typeof e === "object" && "code" in e && e.code === 4001)
        : error;
    const rejected = !!cause && typeof cause === "object" && "code" in cause && cause.code === 4001;
    const reverted = error instanceof Error && error.message === "Transaction reverted";
    emit(sent && !reverted ? "status_unknown" : rejected && !sent ? "rejected" : "failed");
    throw error;
  }
}

export function trackFundingResult(hash: string, destination: string, chainId: number, status: string) {
  if (!["bridge_filled", "origin_tx_reverted", "bridge_failed"].includes(status)) return;
  try {
    const key = `basqit-analytics:${hash}:${status}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    trackEvent("funding_result", {
      destination_token: destination,
      source_chain: chainId,
      destination_chain: 4663,
      status,
    });
  } catch {
    /* Storage/analytics restrictions must not affect tracking the transfer itself. */
  }
}
