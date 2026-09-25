export const WAITLIST_PRODUCTS = ["baskets", "packs"] as const;
export type WaitlistProduct = (typeof WAITLIST_PRODUCTS)[number];

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

export function parseWaitlist(body: unknown): { email: string; product: WaitlistProduct } | null {
  if (!body || typeof body !== "object") return null;
  const { email, product } = body as Record<string, unknown>;
  if (typeof email !== "string" || typeof product !== "string") return null;
  const clean = email.trim().toLowerCase();
  if (clean.length > 254 || !EMAIL.test(clean)) return null;
  if (!(WAITLIST_PRODUCTS as readonly string[]).includes(product)) return null;
  return { email: clean, product: product as WaitlistProduct };
}

/** Resend segment for a product, from env: one segment per product, so one contact can sit in both. */
export function waitlistSegment(product: WaitlistProduct, env: Record<string, string | undefined> = process.env) {
  return (product === "baskets" ? env.RESEND_SEGMENT_BASKETS : env.RESEND_SEGMENT_PACKS) || undefined;
}
