-- Basket value-per-share history. Applied once: psql "$DATABASE_URL" -f services/baskets/schema.sql
create table if not exists basket_snapshots (
  chain_id   int         not null,
  basket     text        not null,
  at         timestamptz not null,
  value_usdg bigint      not null,
  supply     numeric     not null,
  source     text        not null default 'cron' check (source in ('cron', 'chain')),
  primary key (chain_id, basket, at)
);
