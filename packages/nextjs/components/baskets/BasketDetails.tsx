"use client";

import { useState } from "react";
import Link from "next/link";
import { type ActivityRow, ActivityTable, HoldersTable } from "./ActivityTables";
import { ManagePanel } from "./ManagePanel";
import { ValueChart } from "./ValueChart";
import { useQuery } from "@tanstack/react-query";
import { type Address, erc20Abi } from "viem";
import { useAccount } from "wagmi";
import { StockLogo } from "~~/components/StockLogo";
import { BasketTradeDialog } from "~~/components/packs/BasketTradeDialog";
import { useBasketTrades } from "~~/components/packs/useBasketTrades";
import { deployment, formatToken, useTestUsdg, useTokens } from "~~/components/packs/usePacks";
import { basketAbi, priceAbi } from "~~/services/baskets/abi";
import { rulesLine, valuePerShare } from "~~/services/baskets/value";
import { explorerAddress, packsClient, testnetAssets } from "~~/services/packs/testnet";

const RANGES = [
  ["1d", "1D"],
  ["1w", "1W"],
  ["all", "All"],
] as const;
type Range = (typeof RANGES)[number][0];

/** Everything about one basket: holdings, value history, holders, transactions; Buy and Sell as on the cards. */
export function BasketDetails({ basket }: { basket: Address }) {
  const { address } = useAccount();
  const tokens = useTokens();
  const { buy, sell } = useBasketTrades();
  const usdgBalance = useTestUsdg(address).data;
  const [range, setRange] = useState<Range>("all");
  const [trading, setTrading] = useState<"buy" | "sell">();

  const detail = useQuery({
    queryKey: ["packs-basket-detail", basket, address],
    refetchInterval: 15_000,
    queryFn: async () => {
      const b = { address: basket, abi: basketAbi } as const;
      const [
        name,
        symbol,
        components,
        supply,
        manager,
        notice,
        slippage,
        readyAt,
        lastRebalanceAt,
        lossStart,
        lossUsed,
      ] = await packsClient.multicall({
        allowFailure: false,
        contracts: [
          { ...b, functionName: "name" },
          { ...b, functionName: "symbol" },
          { ...b, functionName: "components" },
          { ...b, functionName: "totalSupply" },
          { ...b, functionName: "manager" },
          { ...b, functionName: "noticePeriod" },
          { ...b, functionName: "maxSlippageBps" },
          { ...b, functionName: "rebalanceReadyAt" },
          { ...b, functionName: "lastRebalanceAt" },
          { ...b, functionName: "lossWindowStart" },
          { ...b, functionName: "lossBpsInWindow" },
        ],
      });
      const [{ usdg }, block, balance, fee, feesOn] = await Promise.all([
        testnetAssets(),
        packsClient.getBlock(),
        address
          ? packsClient.readContract({ address: basket, abi: erc20Abi, functionName: "balanceOf", args: [address] })
          : Promise.resolve(0n),
        packsClient.readContract({
          address: deployment.factory,
          abi: deployment.abis.factory,
          functionName: "creatorFee",
          args: [basket],
        }) as Promise<readonly [Address, number]>,
        packsClient.readContract({
          address: deployment.factory,
          abi: deployment.abis.factory,
          functionName: "feesEnabled",
        }) as Promise<boolean>,
      ]);
      const priced = components.filter(c => c.token.toLowerCase() !== usdg.toLowerCase());
      const prices = await packsClient.multicall({
        allowFailure: false,
        contracts: priced.map(c => ({
          address: deployment.swapAdapter,
          abi: priceAbi,
          functionName: "priceUsdG" as const,
          args: [c.token] as const,
        })),
      });
      const priceOf = Object.fromEntries(priced.map((c, i) => [c.token.toLowerCase(), prices[i]]));
      return {
        name,
        symbol,
        components: [...components],
        supply,
        usdg,
        prices: priceOf,
        perShare: valuePerShare([...components], priceOf, usdg),
        balance,
        feeBps: feesOn ? BigInt(fee[1]) : 0n,
        rules: { manager, noticeSeconds: Number(notice), maxSlippageBps: Number(slippage) },
        readyAt: Number(readyAt),
        lastRebalanceAt: Number(lastRebalanceAt),
        lossWindowStart: Number(lossStart),
        lossBpsInWindow: Number(lossUsed),
        now: Number(block.timestamp),
      };
    },
  });

  const history = useQuery({
    queryKey: ["packs-basket-history", basket, range],
    staleTime: 60_000,
    queryFn: async () => {
      const response = await fetch(`/api/baskets/${basket}/history?range=${range}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Could not load the history");
      return (await response.json()) as {
        points: { at: number; value: string }[];
        rebalances: number[];
        fromChain: boolean;
      };
    },
  });

  const activity = useQuery({
    queryKey: ["packs-basket-activity", basket],
    refetchInterval: 15_000,
    queryFn: async () => {
      const response = await fetch(`/api/baskets/${basket}/activity`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Could not load holders and transactions");
      return (await response.json()) as { holders: { address: string; shares: string }[]; activity: ActivityRow[] };
    },
  });

  if (activity.data === null || history.data === null)
    return (
      <section className="bq-details-missing">
        <p>This basket does not exist on Robinhood Chain testnet.</p>
        <Link href="/baskets">Back to baskets</Link>
      </section>
    );

  const retry = (label: string, refetch: () => unknown) => (
    <p className="bq-demo-error" role="alert">
      Could not load {label}.{" "}
      <button className="btn btn-sm" onClick={() => refetch()}>
        Retry
      </button>
    </p>
  );
  const d = detail.data;
  const label = (token: string) => tokens.data?.[token.toLowerCase()];
  const creator = activity.data?.activity.find(r => r.kind === "created")?.who;

  return (
    <>
      <header className="bq-details-header">
        <div>
          <p className="bq-soon-status">Testnet · Test tokens only</p>
          <h1>
            {d?.name ?? "Basket"} <small>{d?.symbol}</small>
          </h1>
          {d && <p className="bq-basket-rules-line">{rulesLine(d.rules)}</p>}
          <p className="bq-details-meta">
            {creator && <>Created by {`${creator.slice(0, 6)}…${creator.slice(-4)}`} · </>}
            <a href={explorerAddress(basket)} target="_blank" rel="noreferrer">
              Contract
            </a>
          </p>
        </div>
        <div className="bq-demo-row">
          <button className="btn btn-primary btn-sm" disabled={!d?.perShare} onClick={() => setTrading("buy")}>
            Buy
          </button>
          <button className="btn btn-secondary btn-sm" disabled={!d?.balance} onClick={() => setTrading("sell")}>
            Sell
          </button>
        </div>
      </header>
      {detail.isError && retry("this basket", detail.refetch)}

      {d && (
        <section className="bq-demo-card">
          <h2>One share holds</h2>
          <ul className="bq-demo-items">
            {d.components.map(c => {
              const info = label(c.token);
              const isUsdg = c.token.toLowerCase() === d.usdg.toLowerCase();
              const price = d.prices[c.token.toLowerCase()];
              const value = isUsdg ? c.unitsPerShare : price ? (c.unitsPerShare * price) / 10n ** 18n : undefined;
              return (
                <li key={c.token}>
                  <StockLogo symbol={info?.ticker ?? ""} size={24} />
                  {info ? `${formatToken(c.unitsPerShare, info.decimals)} ${info.symbol}` : "…"}
                  {value !== undefined && <span className="bq-details-value">${formatToken(value, 6)}</span>}
                </li>
              );
            })}
          </ul>
          <p className="bq-demo-price">
            {d.perShare !== null ? `$${formatToken(d.perShare, 6)} a share today` : "Value unavailable"} ·{" "}
            {formatToken(d.supply, 18)} shares out
          </p>
        </section>
      )}

      <section className="bq-demo-card">
        <div className="bq-details-chart-head">
          <h2>Value per share</h2>
          <div className="bq-segment" role="group" aria-label="Chart range">
            {RANGES.map(([key, name]) => (
              <button key={key} type="button" aria-pressed={range === key} onClick={() => setRange(key)}>
                {name}
              </button>
            ))}
          </div>
        </div>
        {history.isError && retry("the history", history.refetch)}
        {history.isPending && <p role="status">Loading history…</p>}
        {history.data && (
          <>
            <ValueChart
              points={history.data.points.map(p => ({ at: p.at, value: Number(p.value) / 1e6 }))}
              rebalances={history.data.rebalances}
            />
            {history.data.fromChain && <p className="bq-demo-note">History from chain.</p>}
          </>
        )}
      </section>

      {d && address && d.rules.manager.toLowerCase() === address.toLowerCase() && (
        <ManagePanel
          basket={basket}
          state={d}
          onDone={() => {
            void detail.refetch();
            void history.refetch();
            void activity.refetch();
          }}
        />
      )}

      <section className="bq-demo-card">
        <h2>Holders</h2>
        {activity.isError && retry("holders", activity.refetch)}
        {activity.data && <HoldersTable holders={activity.data.holders} supply={d?.supply ?? 0n} you={address} />}
      </section>

      <section className="bq-demo-card">
        <h2>Transactions</h2>
        {activity.isError && retry("transactions", activity.refetch)}
        {activity.data && <ActivityTable rows={activity.data.activity} now={d?.now ?? 0} />}
      </section>

      {trading && d && (
        <BasketTradeDialog
          key={trading}
          basket={{
            symbol: d.symbol,
            name: d.name,
            perShare: d.perShare ?? 0n,
            feeBps: d.feeBps,
            shares: d.balance,
          }}
          initialSide={trading}
          usdg={usdgBalance}
          onBuy={budget => buy(basket, budget, d.perShare ?? 0n, d.feeBps)}
          onSell={amount => sell(basket, amount, d.feeBps)}
          onClose={() => setTrading(undefined)}
        />
      )}
    </>
  );
}
