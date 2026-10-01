"use client";

import { useEffect, useRef, useState } from "react";
import { PendingPlan, when } from "./PendingPlan";
import { useQuery } from "@tanstack/react-query";
import { type Address, formatUnits, parseUnits } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { StockLogo } from "~~/components/StockLogo";
import { deadlineIn, demoError, deployment, formatToken, usePacksWrite, useTokens } from "~~/components/packs/usePacks";
import { basketAbi, priceAbi } from "~~/services/baskets/abi";
import { type Draft, planEstimate, planStatus, toContractPlan } from "~~/services/baskets/plan";
import type { Component } from "~~/services/baskets/value";
import { packsClient, robinhoodTestnet, testnetAssets } from "~~/services/packs/testnet";

const WINDOW = 86_400;
const INTERVAL = 14_400;
const LOSS_WINDOW = 604_800;

export type ManagedState = {
  components: Component[];
  supply: bigint;
  usdg: string;
  rules: { noticeSeconds: number; maxSlippageBps: number };
  readyAt: number;
  lastRebalanceAt: number;
  lossWindowStart: number;
  lossBpsInWindow: number;
  now: number;
};

/** Contract errors in the creator's words; anything else falls back to the wallet's message. */
function explain(failure: unknown, slippageBps: number) {
  const message = demoError(failure);
  const known: [string, string][] = [
    ["ValueLost", `The swaps would lose more than your ${slippageBps / 100}% limit.`],
    ["LossBudgetExceeded", "This would use more than this week's loss budget."],
    ["RebalanceTooSoon", "Too soon: rebalances are at least 4 hours apart."],
    ["TokenNotAllowed", "A token you are buying is no longer allowed."],
    ["RebalanceNotReady", "The notice period has not ended yet."],
    ["RebalanceExpired", "This plan lapsed. Announce it again."],
    ["NoShares", "The basket has no shares yet."],
  ];
  return known.find(([name]) => message.includes(name))?.[1] ?? message;
}

const legs = (count: number) =>
  Array.from({ length: count }, () => ({
    adapter: deployment.swapAdapter,
    minAmountOut: 0n,
    routeData: "0x" as const,
  }));

/** The manager's controls: plan, announce or rebalance now, then execute or cancel an announced plan. */
export function ManagePanel({ basket, state, onDone }: { basket: Address; state: ManagedState; onDone: () => void }) {
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const write = usePacksWrite();
  const tokens = useTokens();
  const label = (token: string) => tokens.data?.[token.toLowerCase()];
  const decimals = (token: string) => label(token)?.decimals ?? 18;

  // Chain time, ticking each second between the 15-second refreshes, so countdowns and window changes show live.
  const [now, setNow] = useState(state.now);
  const skew = useRef(0);
  useEffect(() => {
    skew.current = state.now - Date.now() / 1000;
  }, [state.now]);
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000 + skew.current)), 1000);
    return () => clearInterval(id);
  }, []);

  const allowed = useQuery({
    queryKey: ["packs-manage-allowed", basket],
    queryFn: async () => {
      const { stocks } = await testnetAssets();
      const prices = await packsClient.multicall({
        allowFailure: false,
        contracts: stocks.map(token => ({
          address: deployment.swapAdapter,
          abi: priceAbi,
          functionName: "priceUsdG" as const,
          args: [token] as const,
        })),
      });
      return {
        tokens: [...stocks, state.usdg as Address],
        prices: Object.fromEntries(stocks.map((t, i) => [t.toLowerCase(), prices[i]])) as Record<string, bigint>,
      };
    },
  });
  const pending = useQuery({
    queryKey: ["packs-manage-pending", basket, state.readyAt],
    enabled: state.readyAt > 0,
    queryFn: () => packsClient.readContract({ address: basket, abi: basketAbi, functionName: "pendingRebalance" }),
  });

  // Only edited amounts are stored; untouched rows show (and keep) today's amount.
  const [sells, setSells] = useState<Record<string, string>>({});
  const [buys, setBuys] = useState<{ token: string; percent: string }[]>([{ token: "", percent: "100" }]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const status = planStatus({
    now,
    readyAt: state.readyAt,
    window: WINDOW,
    lastRebalanceAt: state.lastRebalanceAt,
    interval: INTERVAL,
  });

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError("");
    try {
      await action();
      onDone();
    } catch (failure) {
      setError(explain(failure, state.rules.maxSlippageBps));
    } finally {
      setBusy("");
    }
  };

  const actions = (children: React.ReactNode) =>
    chainId !== robinhoodTestnet.id ? (
      <button
        className="btn btn-primary btn-sm"
        disabled={!!busy}
        onClick={() => run("Switching…", () => switchChainAsync({ chainId: robinhoodTestnet.id }))}
      >
        {busy || "Switch to Robinhood Chain Testnet"}
      </button>
    ) : (
      children
    );

  const errorLine = error ? (
    <p className="bq-demo-error" role="alert">
      {error}
    </p>
  ) : null;

  // An announced plan: read-only, with its window, Execute when open and Cancel at any time.
  if (status.state === "waiting" || status.state === "ready") {
    const plan = pending.data;
    return (
      <section className="bq-demo-card bq-manage">
        <h2>Manage</h2>
        {plan ? (
          <PendingPlan sells={plan[0]} buys={plan[1]} components={state.components} />
        ) : (
          <p role="status">Loading the announced plan…</p>
        )}
        <p className="bq-manage-window">
          {status.state === "waiting"
            ? `Can execute from ${when(status.opensAt)} until ${when(status.closesAt)} · opens in ${Math.ceil(
                (status.opensAt - now) / 60,
              )} min`
            : `Execute before ${when(status.closesAt)}`}
        </p>
        {actions(
          <div className="bq-demo-row">
            <button
              className="btn btn-primary btn-sm"
              disabled={status.state !== "ready" || !plan || !!busy}
              onClick={() =>
                run("Executing…", () =>
                  write({
                    address: basket,
                    abi: basketAbi,
                    functionName: "executeRebalance",
                    args: [legs(plan![0].length), legs(plan![1].length), deadlineIn(20)],
                  }),
                )
              }
            >
              {busy === "Executing…" ? busy : "Execute"}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={!!busy}
              onClick={() =>
                run("Cancelling…", () => write({ address: basket, abi: basketAbi, functionName: "cancelRebalance" }))
              }
            >
              {busy === "Cancelling…" ? busy : "Cancel"}
            </button>
          </div>,
        )}
        {errorLine}
      </section>
    );
  }

  // The form: lower holdings, split the proceeds, see the estimate and the limits, then announce or rebalance.
  const parse = (token: string, text: string, fallback: bigint) => {
    try {
      return parseUnits(text.trim() || "0", decimals(token));
    } catch {
      return fallback;
    }
  };
  const draft: Draft = {
    sells: Object.fromEntries(
      state.components.map(c => [
        c.token,
        sells[c.token] === undefined ? c.unitsPerShare : parse(c.token, sells[c.token], c.unitsPerShare),
      ]),
    ),
    buys: Object.fromEntries(buys.filter(b => b.token).map(b => [b.token, Number(b.percent) || 0])),
  };
  const plan = toContractPlan(state.components, draft);
  const prices = { ...allowed.data?.prices };
  const estimate = planEstimate({
    current: state.components,
    draft,
    supply: state.supply,
    prices,
    usdg: state.usdg,
  });
  const choices = (allowed.data?.tokens ?? []).filter(
    t =>
      !state.components.some(c => c.token.toLowerCase() === t.toLowerCase() && draft.sells[c.token] < c.unitsPerShare),
  );
  const lossUsed = now >= state.lossWindowStart + LOSS_WINDOW ? 0 : state.lossBpsInWindow;
  const nextAllowedAt = status.state === "none" ? status.nextAllowedAt : undefined;
  const tooSoon = !!nextAllowedAt && nextAllowedAt > now;
  const instant = state.rules.noticeSeconds === 0;
  const problem = "error" in plan ? plan.error : "error" in estimate ? estimate.error : "";

  return (
    <section className="bq-demo-card bq-manage">
      <h2>Manage</h2>
      {status.state === "lapsed" && <p className="bq-demo-note">The announced plan lapsed. Plan a new one below.</p>}
      <p className="bq-manage-label">Lower what one share holds</p>
      <ul className="bq-demo-builder-rows bq-basket-rows bq-manage-rows">
        {state.components.map(c => (
          <li key={c.token}>
            <StockLogo symbol={label(c.token)?.ticker ?? ""} size={28} />
            <span className="bq-basket-name">
              <b>{label(c.token)?.symbol ?? "…"}</b>
              <small>now {formatToken(c.unitsPerShare, decimals(c.token))} per share</small>
            </span>
            <input
              className="input input-sm bq-basket-qty"
              inputMode="decimal"
              aria-label={`${label(c.token)?.symbol ?? "Token"} per share after the rebalance`}
              value={sells[c.token] ?? formatUnits(c.unitsPerShare, decimals(c.token))}
              onChange={event => setSells(current => ({ ...current, [c.token]: event.target.value }))}
            />
          </li>
        ))}
      </ul>

      <p className="bq-manage-label">Buy with the proceeds</p>
      <ul className="bq-manage-buys">
        {buys.map((b, i) => (
          <li key={i}>
            <select
              className="select select-sm"
              aria-label="Token to buy"
              value={b.token}
              onChange={event =>
                setBuys(current => current.map((x, j) => (j === i ? { ...x, token: event.target.value } : x)))
              }
            >
              <option value="">Choose a token</option>
              {choices.map(t => (
                <option key={t} value={t}>
                  {label(t)?.symbol ?? t.slice(0, 8)}
                </option>
              ))}
            </select>
            <span className="bq-basket-unit">
              <input
                className="input input-sm"
                inputMode="decimal"
                aria-label="Share of the proceeds in percent"
                value={b.percent}
                onChange={event =>
                  setBuys(current => current.map((x, j) => (j === i ? { ...x, percent: event.target.value } : x)))
                }
              />
              <em>%</em>
            </span>
            {buys.length > 1 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label="Remove this token"
                onClick={() => setBuys(current => current.filter((_, j) => j !== i))}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="bq-demo-row">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={buys.length >= 10}
          onClick={() => setBuys(current => [...current, { token: "", percent: "0" }])}
        >
          + Add token
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() =>
            setBuys(current => {
              const even = Math.floor(10_000 / current.length) / 100;
              return current.map((x, i) => ({
                ...x,
                percent: String(i === current.length - 1 ? +(100 - even * (current.length - 1)).toFixed(2) : even),
              }));
            })
          }
        >
          Even split
        </button>
      </div>

      {"perBuy" in estimate && (
        <dl className="bq-manage-estimate">
          <div>
            <dt>Sold per share</dt>
            <dd>${formatToken(estimate.soldValue, 6)}</dd>
          </div>
          {estimate.perBuy.map(b => (
            <div key={b.token}>
              <dt>{label(b.token)?.symbol ?? "…"} per share</dt>
              <dd>
                +{formatToken(b.unitsPerShare, decimals(b.token))} (${formatToken(b.usdg, 6)})
              </dd>
            </div>
          ))}
        </dl>
      )}
      <ul className="bq-manage-limits">
        <li>Max loss on this rebalance {state.rules.maxSlippageBps / 100}%</li>
        <li>
          7-day budget used {lossUsed / 100}% of {state.rules.maxSlippageBps / 50}%
        </li>
        {tooSoon && <li>Next rebalance possible from {when(nextAllowedAt!)}</li>}
        <li>Estimate at reference prices, before swap costs.</li>
      </ul>

      {actions(
        <button
          className="btn btn-primary btn-sm bq-manage-go"
          disabled={!!busy || !!problem || (instant && tooSoon)}
          onClick={() => {
            if ("error" in plan) return;
            void run(instant ? "Rebalancing…" : "Announcing…", () =>
              instant
                ? write({
                    address: basket,
                    abi: basketAbi,
                    functionName: "rebalanceNow",
                    args: [plan.sells, plan.buys, legs(plan.sells.length), legs(plan.buys.length), deadlineIn(20)],
                  })
                : write({
                    address: basket,
                    abi: basketAbi,
                    functionName: "scheduleRebalance",
                    args: [plan.sells, plan.buys],
                  }),
            );
          }}
        >
          {busy || (instant ? "Rebalance now" : `Announce (executes in ${state.rules.noticeSeconds / 3600} h)`)}
        </button>,
      )}
      {problem && <p className="bq-demo-note">{problem}</p>}
      {errorLine}
    </section>
  );
}
