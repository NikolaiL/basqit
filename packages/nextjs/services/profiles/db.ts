import type { Profile } from "./profile.ts";
import type { Platform, Social } from "./social.ts";
import { neon } from "@neondatabase/serverless";

const sql = () => neon(process.env.DATABASE_URL!);
type Signed = { message: string; signature: string; signedAt: Date };

export async function readProfile(address: string) {
  const [row] = (await sql()`
    select name, bio, avatar, website, signed_at as "signedAt"
    from creator_profiles where address = ${address.toLowerCase()}`) as (Profile & { signedAt: Date })[];
  return row ?? null;
}

/** Saves only when this signature is newer than the stored one, so an old signed update cannot be replayed. */
export async function saveProfile(address: string, p: Profile, s: Signed) {
  const rows = await sql()`
    insert into creator_profiles (address, name, bio, avatar, website, message, signature, signed_at)
    values (${address.toLowerCase()}, ${p.name}, ${p.bio}, ${p.avatar}, ${p.website},
            ${s.message}, ${s.signature}, ${s.signedAt})
    on conflict (address) do update set
      name = excluded.name, bio = excluded.bio, avatar = excluded.avatar, website = excluded.website,
      message = excluded.message,
      signature = excluded.signature, signed_at = excluded.signed_at
    where creator_profiles.signed_at < excluded.signed_at
    returning 1`;
  return rows.length > 0;
}

export async function readDescription(chainId: number, basket: string) {
  const [row] = (await sql()`
    select description, creator, signed_at as "signedAt" from basket_descriptions
    where chain_id = ${chainId} and basket = ${basket.toLowerCase()}`) as {
    description: string;
    creator: string;
    signedAt: Date;
  }[];
  return row ?? null;
}

export async function saveDescription(chainId: number, basket: string, creator: string, text: string, s: Signed) {
  const rows = await sql()`
    insert into basket_descriptions (chain_id, basket, description, creator, message, signature, signed_at)
    values (${chainId}, ${basket.toLowerCase()}, ${text}, ${creator.toLowerCase()}, ${s.message}, ${s.signature},
            ${s.signedAt})
    on conflict (chain_id, basket) do update set
      description = excluded.description, creator = excluded.creator, message = excluded.message,
      signature = excluded.signature, signed_at = excluded.signed_at
    where basket_descriptions.signed_at < excluded.signed_at
    returning 1`;
  return rows.length > 0;
}

export async function readSocials(address: string) {
  return (await sql()`
    select platform, account_id as "accountId", username from social_links
    where address = ${address.toLowerCase()} order by platform`) as Social[];
}

export async function saveSocial(address: string, s: Social) {
  await sql()`
    insert into social_links (address, platform, account_id, username)
    values (${address.toLowerCase()}, ${s.platform}, ${s.accountId}, ${s.username})
    on conflict (address, platform) do update set
      account_id = excluded.account_id, username = excluded.username, verified_at = now()`;
}

export async function deleteSocial(address: string, platform: Platform) {
  await sql()`delete from social_links where address = ${address.toLowerCase()} and platform = ${platform}`;
}
