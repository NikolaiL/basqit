// Creator profiles and basket descriptions: off-chain text, each update signed by the wallet it describes.
// Client and server build the signed message with the same functions, so the server never trusts client text.
import { keccak256, toBytes } from "viem";

export type Profile = { name: string; bio: string; avatar: string; website: string };
export const EMPTY_PROFILE: Profile = { name: "", bio: "", avatar: "", website: "" };
export const LIMITS = { name: 40, bio: 280, description: 600, avatar: 80_000 };
/** How long a signed update stays acceptable. */
export const SIGNATURE_SECONDS = 10 * 60;

const AVATAR = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const text = (value: unknown, max: number, label: string) => {
  const s = typeof value === "string" ? value.trim().replace(/\r\n/g, "\n") : "";
  if (s.length > max) throw new Error(`${label} is longer than ${max} characters.`);
  return s;
};

/** Validates untrusted input into a Profile; throws a message fit for the user. */
export function cleanProfile(input: unknown): Profile {
  const p = (input ?? {}) as Record<string, unknown>;
  const avatar = typeof p.avatar === "string" ? p.avatar : "";
  if (avatar && (avatar.length > LIMITS.avatar || !AVATAR.test(avatar)))
    throw new Error("The picture must be a small PNG, JPEG or WebP image.");
  const website = text(p.website, 200, "Website");
  if (website) {
    let url: URL | undefined;
    try {
      url = new URL(website);
    } catch {}
    if (url?.protocol !== "https:") throw new Error("Website must be a full https:// link.");
  }
  return {
    name: text(p.name, LIMITS.name, "Name").replace(/\s+/g, " "),
    bio: text(p.bio, LIMITS.bio, "Bio"),
    avatar,
    website,
  };
}

export const cleanDescription = (input: unknown) => text(input, LIMITS.description, "Description");

const FOOTER = "This only updates public text on Basqit. It does not authorize any transaction.";

/** The exact text the wallet signs for a profile update. The picture is signed by its hash to keep the prompt short. */
export function profileMessage(address: string, p: Profile, issuedAt: string) {
  return [
    "Basqit creator profile update",
    "",
    `Wallet: ${address.toLowerCase()}`,
    `Name: ${JSON.stringify(p.name)}`,
    `Bio: ${JSON.stringify(p.bio)}`,
    `Picture: ${p.avatar ? keccak256(toBytes(p.avatar)) : "none"}`,
    `Website: ${p.website || "none"}`,
    `Issued at: ${issuedAt}`,
    "",
    FOOTER,
  ].join("\n");
}

/** The exact text the creator signs to describe a basket. Chain and basket are included so it cannot be reused. */
export function descriptionMessage(chainId: number, basket: string, description: string, issuedAt: string) {
  return [
    "Basqit basket description update",
    "",
    `Chain: ${chainId}`,
    `Basket: ${basket.toLowerCase()}`,
    `Description: ${JSON.stringify(description)}`,
    `Issued at: ${issuedAt}`,
    "",
    FOOTER,
  ].join("\n");
}

/** Parses a signed timestamp; rejects anything stale, from the future, or not newer than the stored update. */
export function checkIssuedAt(issuedAt: unknown, now = Date.now(), previous?: Date) {
  const at = typeof issuedAt === "string" && issuedAt.length < 40 ? new Date(issuedAt) : new Date(NaN);
  if (Number.isNaN(at.getTime()) || at.toISOString() !== issuedAt) throw new Error("Invalid signing time.");
  if (at.getTime() > now + 60_000 || at.getTime() < now - SIGNATURE_SECONDS * 1000)
    throw new Error("This signature expired. Please sign again.");
  if (previous && at <= previous) throw new Error("A newer update is already saved.");
  return at;
}

export const socialUrl = (s: { platform: string; accountId: string; username: string }) =>
  s.platform === "x"
    ? `https://x.com/${s.username}`
    : s.username
      ? `https://farcaster.xyz/${s.username}`
      : `https://farcaster.xyz/~/profiles/${s.accountId}`;
