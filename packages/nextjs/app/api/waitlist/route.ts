import { NextResponse } from "next/server";
import { parseWaitlist, waitlistSegment } from "~~/services/waitlist/waitlist";

// ponytail: per-process limiter; move to a shared store before running several instances.
const hits = new Map<string, number[]>();
const LIMIT = 5;
const WINDOW = 60_000;

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(time => now - time < WINDOW);
  if (recent.length >= LIMIT) return NextResponse.json({ error: "Too many tries. Wait a minute." }, { status: 429 });
  hits.set(ip, [...recent, now]);
  if (hits.size > 5000) hits.clear();

  const body = await request.json().catch(() => null);
  // Honeypot: people never see this field, bots fill it. Pretend success so they move on.
  if (body && typeof body === "object" && (body as Record<string, unknown>).website)
    return NextResponse.json({ ok: true });
  const entry = parseWaitlist(body);
  if (!entry) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  const key = process.env.RESEND_API_KEY;
  if (!key) return NextResponse.json({ error: "Sign-ups open soon. Please check back." }, { status: 503 });
  const resend = (path: string, body?: unknown) =>
    fetch(`https://api.resend.com${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
  const segment = waitlistSegment(entry.product);
  const created = await resend("/contacts", {
    email: entry.email,
    unsubscribed: false,
    ...(segment ? { segments: [segment] } : {}),
  });
  // Already a contact (signed up for the other product): add them to this product's segment instead.
  const saved =
    created?.ok ||
    (!!created &&
      !!segment &&
      (await resend(`/contacts/${encodeURIComponent(entry.email)}/segments/${encodeURIComponent(segment)}`))?.ok);
  if (!saved) return NextResponse.json({ error: "Could not save your email. Try again." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
