import type { Point } from "./history.ts";
import { neon } from "@neondatabase/serverless";

const CHAIN_ID = 46630;
const sql = () => neon(process.env.DATABASE_URL!);

export const hasDatabase = () => !!process.env.DATABASE_URL;

/** Saves points; an existing point for the same basket and time is kept, so a rebuild never overwrites the cron. */
export async function insertSnapshots(basket: string, points: Point[]) {
  if (!points.length) return;
  await sql()`
    insert into basket_snapshots (chain_id, basket, at, value_usdg, supply, source)
    select ${CHAIN_ID}, ${basket.toLowerCase()}, to_timestamp(t), v, s, src
    from unnest(
      ${points.map(p => p.at)}::float8[],
      ${points.map(p => p.value.toString())}::bigint[],
      ${points.map(p => p.supply.toString())}::numeric[],
      ${points.map(p => p.source)}::text[]
    ) as x(t, v, s, src)
    on conflict do nothing`;
}

export async function readSnapshots(basket: string, from: number): Promise<Point[]> {
  const rows = (await sql()`
    select extract(epoch from at)::float8 as at, value_usdg::text as value, supply::text as supply, source
    from basket_snapshots
    where chain_id = ${CHAIN_ID} and basket = ${basket.toLowerCase()} and at >= to_timestamp(${from})
    order by at`) as { at: number; value: string; supply: string; source: Point["source"] }[];
  return rows.map(r => ({ at: Math.round(r.at), value: BigInt(r.value), supply: BigInt(r.supply), source: r.source }));
}

export async function earliestSnapshot(basket: string): Promise<number | null> {
  const [row] = (await sql()`
    select extract(epoch from min(at))::float8 as at from basket_snapshots
    where chain_id = ${CHAIN_ID} and basket = ${basket.toLowerCase()}`) as { at: number | null }[];
  return row?.at == null ? null : Math.round(row.at);
}

/** Whether a rebuild from chain was ever saved for this basket. */
export async function hasRebuild(basket: string): Promise<boolean> {
  const [row] = (await sql()`
    select exists(
      select 1 from basket_snapshots
      where chain_id = ${CHAIN_ID} and basket = ${basket.toLowerCase()} and source = 'chain'
    ) as rebuilt`) as { rebuilt: boolean }[];
  return !!row?.rebuilt;
}

/** Per basket: the first stored value per share, and the first one inside the last 24 hours and 7 days. */
export async function readValueRefs() {
  return (await sql()`
    select b.basket,
      extract(epoch from (select min(at) from basket_snapshots s
        where s.chain_id = b.chain_id and s.basket = b.basket))::float8 as "firstAt",
      (select value_usdg::text from basket_snapshots s
        where s.chain_id = b.chain_id and s.basket = b.basket order by at limit 1) as "all",
      (select value_usdg::text from basket_snapshots s
        where s.chain_id = b.chain_id and s.basket = b.basket and at >= now() - interval '1 day'
        order by at limit 1) as "24h",
      (select value_usdg::text from basket_snapshots s
        where s.chain_id = b.chain_id and s.basket = b.basket and at >= now() - interval '7 days'
        order by at limit 1) as "7d"
    from (select distinct chain_id, basket from basket_snapshots where chain_id = ${CHAIN_ID}) b`) as {
    basket: string;
    firstAt: number;
    all: string;
    "24h": string | null;
    "7d": string | null;
  }[];
}
