-- Creator profiles and basket descriptions. Applied once: psql "$DATABASE_URL" -f services/profiles/schema.sql
-- Each row keeps the signed message and signature, so anyone can re-check who wrote it.
create table if not exists creator_profiles (
  address    text        primary key,
  name       text        not null default '',
  bio        text        not null default '',
  avatar     text        not null default '',
  website    text        not null default '',
  message    text        not null,
  signature  text        not null,
  signed_at  timestamptz not null
);

create table if not exists basket_descriptions (
  chain_id    int         not null,
  basket      text        not null,
  description text        not null,
  creator     text        not null,
  message     text        not null,
  signature   text        not null,
  signed_at   timestamptz not null,
  primary key (chain_id, basket)
);

-- Accounts proven by signing in to them (X OAuth, Sign In with Farcaster), linked to the signed-in wallet.
create table if not exists social_links (
  address     text        not null,
  platform    text        not null check (platform in ('x', 'farcaster')),
  account_id  text        not null,
  username    text        not null,
  verified_at timestamptz not null default now(),
  primary key (address, platform)
);
