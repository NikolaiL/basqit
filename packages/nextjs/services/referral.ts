import { getAddress, isAddress } from "viem";

// Kept in localStorage for client features (packs, gifts…) and mirrored to a cookie so quote routes read it.
export const REFERRAL_KEY = "basqit.ref";
export const REFERRAL_COOKIE = "basqit_ref";

const valid = (value: string | null): value is `0x${string}` =>
  !!value && isAddress(value) && !/^0x0{40}$/i.test(value);

/** Stores a valid ?ref= wallet (latest visit wins) and re-syncs the cookie from storage on every load. */
export function captureReferral(search: string) {
  try {
    const ref = new URLSearchParams(search).get("ref");
    if (valid(ref)) localStorage.setItem(REFERRAL_KEY, getAddress(ref));
    const stored = localStorage.getItem(REFERRAL_KEY);
    if (valid(stored)) document.cookie = `${REFERRAL_COOKIE}=${stored}; path=/; max-age=31536000; SameSite=Lax; Secure`;
  } catch {
    // Storage blocked (private mode): trades simply carry no referrer.
  }
}

/** Every Basqit share link carries the sharer's wallet, so trades from it credit them. */
export function withRef(url: URL, wallet?: string) {
  if (wallet && valid(wallet)) url.searchParams.set("ref", getAddress(wallet));
  return url;
}
