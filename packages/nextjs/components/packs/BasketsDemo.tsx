"use client";

import { useState } from "react";
import { demoError, deployment, formatToken, usePacksWrite, useTokens } from "./usePacks";
import { useQuery } from "@tanstack/react-query";
import { type Address, formatUnits, parseUnits } from "viem";
import { useAccount } from "wagmi";
import { StockLogo } from "~~/components/StockLogo";
import { BasketGrid } from "~~/components/baskets/BasketGrid";
import { useBasketSummary } from "~~/components/baskets/BasketInfo";
import { useBasketRows } from "~~/components/baskets/useBasketRows";
import { FILTERS, type Filter, SORTS, type Sort, listBaskets } from "~~/services/baskets/list";
import { basketManagement } from "~~/services/packs/management";
import { packsClient, robinhoodTestnet, testnetAssets } from "~~/services/packs/testnet";

const ONE = 10n ** 18n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export function BasketsDemo() {
  const { address, chainId } = useAccount();
  const write = usePacksWrite();
  const tokens = useTokens();
  const [busy, setBusy] = useState("");
  // Stock amounts are what the basket stores; dollars are only a way to type them at today's price.
  const [draft, setDraft] = useState<{ name: string; symbol: string; fee: string; units: Record<string, string> }>({
    name: "",
    symbol: "",
    fee: "0.5",
    units: {},
  });
  const [managementDraft, setManagementDraft] = useState({ managed: false, notice: "24", slippage: "1" });
  const management = basketManagement(managementDraft.managed, managementDraft.notice, managementDraft.slippage);
  const [typingUsd, setTypingUsd] = useState<{ token: Address; text: string }>();
  const ready = !!address && chainId === robinhoodTestnet.id;
  const factory = { address: deployment.factory, abi: deployment.abis.factory } as const;
  const shop = { address: deployment.swapAdapter, abi: deployment.abis.swapAdapter } as const;
  const priceOf = (token: Address) =>
    packsClient.readContract({ ...shop, functionName: "priceUsdG", args: [token] }) as Promise<bigint>;

  const baskets = useBasketRows(address);
  const summary = useBasketSummary();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("value");

  // Every stock the factory lists, with its current price, for the create form.
  const listed = useQuery({
    queryKey: ["packs-basket-listed", deployment.factory],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { stocks } = await testnetAssets();
      return Promise.all(stocks.map(async token => ({ token, price: await priceOf(token) })));
    },
  });

  // The last failure and the action it belongs to, shown right under that action.
  const [failed, setFailed] = useState<{ at: string; message: string }>();
  const errorAt = (label: string) =>
    failed?.at === label ? (
      <p className="bq-demo-error" role="alert">
        {failed.message}
      </p>
    ) : null;
  const act = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setFailed(undefined);
    try {
      await action();
    } catch (failure) {
      setFailed({ at: label, message: demoError(failure) });
    } finally {
      setBusy("");
    }
  };
  const label = (token: Address) => tokens.data?.[token.toLowerCase()];
  // "I hold" and "Mine" need a wallet; without one they are hidden and the list shows all.
  const visible = listBaskets(
    (baskets.data?.rows ?? []).map(row => ({
      ...row,
      managed: BigInt(row.rules.manager) !== 0n,
      tokens: row.parts.map(part => label(part.token)?.symbol ?? ""),
    })),
    {
      query,
      filter: address || (filter !== "held" && filter !== "mine") ? filter : "all",
      sort,
      me: address,
      stats: summary.data,
    },
  );

  // The create form: the stock amount per share is the source of truth; its dollar value follows today's price.
  const unitsOf = (token: Address) => {
    try {
      return parseUnits((draft.units[token] ?? "").trim() || "0", 18);
    } catch {
      return 0n;
    }
  };
  const draftParts = (listed.data ?? []).flatMap(({ token }) =>
    unitsOf(token) > 0n ? [{ token, unitsPerShare: unitsOf(token) }] : [],
  );
  /** Dollars typed for one stock become its amount, rounded to 6 decimals so the amount stays readable. */
  const setDollars = (token: Address, price: bigint, text: string) => {
    setTypingUsd({ token, text });
    let dollars: bigint;
    try {
      dollars = parseUnits(text.trim() || "0", 6);
    } catch {
      return;
    }
    const step = 10n ** 12n;
    const units = price > 0n ? ((dollars * ONE) / price / step) * step : 0n;
    setDraft(current => ({
      ...current,
      units: { ...current.units, [token]: units > 0n ? formatUnits(units, 18) : "" },
    }));
  };
  const draftPrice = draftParts.reduce(
    (sum, part) =>
      sum + ceilDiv(part.unitsPerShare * (listed.data?.find(l => l.token === part.token)?.price ?? 0n), ONE),
    0n,
  );
  const feeBps = Math.round(Number(draft.fee || "0") * 100);
  const canCreate =
    ready &&
    !busy &&
    !listed.isError &&
    !tokens.isError &&
    management !== null &&
    draft.name.trim().length > 0 &&
    draft.symbol.trim().length > 0 &&
    draftParts.length > 0 &&
    feeBps >= 0 &&
    feeBps <= 100;

  return (
    <section className="bq-demo-block">
      <h3>Baskets</h3>
      <p className="bq-demo-note">
        Each share holds test tokens. Fixed baskets keep the same token amounts per share; managed baskets let their
        creator rebalance under rules set at creation. Buying purchases the components; selling redeems and sells them.
        {baskets.data && !baskets.data.feesOn && " Creator fees are switched off on testnet."}
      </p>
      {baskets.isPending && <p role="status">Loading baskets…</p>}
      {baskets.isError && (
        <p className="bq-demo-error" role="alert">
          Could not load baskets.{" "}
          <button className="btn btn-sm" onClick={() => baskets.refetch()}>
            Retry
          </button>
        </p>
      )}
      {baskets.data && (
        <div className="bq-basket-toolbar">
          <input
            className="input input-sm"
            type="search"
            placeholder="Search name, ticker, stock or creator"
            aria-label="Search baskets"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <div className="bq-segment" role="radiogroup" aria-label="Show">
            {FILTERS.filter(([key]) => address || (key !== "held" && key !== "mine")).map(([key, name]) => (
              <label key={key}>
                <input type="radio" name="basket-filter" checked={filter === key} onChange={() => setFilter(key)} />
                {name}
              </label>
            ))}
          </div>
          <label className="bq-basket-sort">
            Sort
            <select className="select select-sm" value={sort} onChange={event => setSort(event.target.value as Sort)}>
              {SORTS.map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {baskets.data && (
        <BasketGrid rows={visible} feesOn={baskets.data.feesOn} checkedAt={baskets.data.checkedAt} busy={!!busy} />
      )}
      {!!baskets.data?.rows.length && !visible.length && (
        <p className="bq-demo-note" role="status">
          No baskets match.{" "}
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            Clear
          </button>
        </p>
      )}

      <article className="bq-demo-card bq-demo-builder bq-basket-builder">
        <strong>Create a basket</strong>
        {(listed.isPending || tokens.isPending) && <p role="status">Loading available tokens…</p>}
        {(listed.isError || tokens.isError) && (
          <p className="bq-demo-error" role="alert">
            Could not load available tokens.{" "}
            <button
              className="btn btn-sm"
              onClick={() => {
                void listed.refetch();
                void tokens.refetch();
              }}
            >
              Retry
            </button>
          </p>
        )}
        {listed.isSuccess && listed.data.length === 0 && <p>No tokens are currently available for new baskets.</p>}
        <div className="bq-demo-row">
          <input
            className="input input-sm"
            placeholder="Name, e.g. Space Economy"
            aria-label="Basket name"
            maxLength={40}
            value={draft.name}
            onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
          />
          <input
            className="input input-sm"
            placeholder="Ticker, e.g. SPACE"
            aria-label="Basket ticker"
            maxLength={10}
            value={draft.symbol}
            onChange={event => setDraft(current => ({ ...current, symbol: event.target.value.toUpperCase() }))}
          />
        </div>
        <div className="bq-basket-cols" aria-hidden>
          <span>Stock in one share</span>
          <span>Value today</span>
        </div>
        <ul className="bq-demo-builder-rows bq-basket-rows">
          {listed.data?.map(({ token, price }) => {
            const info = label(token);
            const value = ceilDiv(unitsOf(token) * price, ONE);
            return (
              <li key={token}>
                <StockLogo symbol={info?.ticker ?? ""} size={28} />
                <span className="bq-basket-name">
                  <b>{info?.symbol ?? "…"}</b>
                  <small>{`$${formatToken(price, 6)} each`}</small>
                </span>
                <input
                  className="input input-sm bq-basket-qty"
                  inputMode="decimal"
                  placeholder="0"
                  aria-label={`${info?.symbol ?? "Stock"} in one share`}
                  value={draft.units[token] ?? ""}
                  onChange={event => {
                    setTypingUsd(undefined);
                    setDraft(current => ({ ...current, units: { ...current.units, [token]: event.target.value } }));
                  }}
                />
                <label className="bq-basket-usd">
                  <span aria-hidden>≈ $</span>
                  <input
                    className="input input-sm"
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={`Value of ${info?.symbol ?? "the stock"} in one share today, in dollars`}
                    value={
                      typingUsd?.token === token
                        ? typingUsd.text
                        : value > 0n
                          ? Number(formatUnits(value, 6)).toFixed(2)
                          : ""
                    }
                    onChange={event => setDollars(token, price, event.target.value)}
                    onBlur={() => setTypingUsd(undefined)}
                  />
                </label>
              </li>
            );
          })}
        </ul>
        <p className="bq-demo-note">
          Type either column. The basket stores the stock amounts; the dollar value moves with the price.
        </p>
        <div className="bq-basket-rules">
          <div className="bq-basket-rule" role="radiogroup" aria-labelledby="basket-type-label">
            <span id="basket-type-label">Type</span>
            <div className="bq-segment">
              {(
                [
                  ["Fixed", false],
                  ["Managed", true],
                ] as const
              ).map(([name, managed]) => (
                <label key={name}>
                  <input
                    type="radio"
                    name="basket-type"
                    checked={managementDraft.managed === managed}
                    onChange={() => setManagementDraft(current => ({ ...current, managed }))}
                  />
                  {name}
                </label>
              ))}
            </div>
          </div>
          <label className="bq-basket-rule">
            Creator fee
            <span className="bq-basket-unit">
              <input
                className="input input-sm"
                inputMode="decimal"
                aria-describedby="basket-rules-help"
                value={draft.fee}
                onChange={event => setDraft(current => ({ ...current, fee: event.target.value }))}
              />
              <em>%</em>
            </span>
          </label>
          {managementDraft.managed && (
            <>
              <label className="bq-basket-rule">
                Notice
                <span className="bq-basket-unit">
                  <input
                    className="input input-sm"
                    inputMode="numeric"
                    aria-describedby="basket-rules-help"
                    value={managementDraft.notice}
                    onChange={event => setManagementDraft(current => ({ ...current, notice: event.target.value }))}
                  />
                  <em>h</em>
                </span>
              </label>
              <label className="bq-basket-rule">
                Max slippage
                <span className="bq-basket-unit">
                  <input
                    className="input input-sm"
                    inputMode="decimal"
                    aria-describedby="basket-rules-help"
                    value={managementDraft.slippage}
                    onChange={event => setManagementDraft(current => ({ ...current, slippage: event.target.value }))}
                  />
                  <em>%</em>
                </span>
              </label>
            </>
          )}
        </div>
        <p
          className={`bq-demo-note bq-basket-rules-help${
            managementDraft.managed && (!management || management.noticeHours === 0) ? " is-alert" : ""
          }`}
          id="basket-rules-help"
          aria-live="polite"
        >
          {!managementDraft.managed
            ? "Fixed: the amounts per share never change. Your fee, up to 1%, is charged on every buy and sell."
            : management
              ? `Managed: you announce each rebalance ${
                  management.noticeHours === 0
                    ? "with no notice, so holders get no warning"
                    : `${management.noticeHours} h ahead, so holders can exit first`
                }. Each one may lose at most ${management.maxSlippageBps / 100}% of what it trades at reference prices, ${
                  management.maxSlippageBps / 50
                }% within 7 days, and runs at most every 4 h. Your fee, up to 1%, is charged on every buy and sell. Type, notice and limit are fixed once published.`
              : "Notice is whole hours from 0 to 72; max slippage is 0.1% to 2%."}
        </p>
        <button
          className="btn btn-primary btn-sm"
          disabled={!canCreate}
          onClick={() =>
            act("create", async () => {
              if (!management) throw new Error("Check the managed-basket settings before publishing.");
              await write({
                ...factory,
                functionName: "createBasket",
                args: [draft.name.trim(), draft.symbol.trim(), draftParts, feeBps, management],
              });
              setDraft({ name: "", symbol: "", fee: "0.5", units: {} });
              setManagementDraft({ managed: false, notice: "24", slippage: "1" });
            })
          }
        >
          {busy === "create"
            ? "Publishing…"
            : draftParts.length
              ? `Publish · one share ≈ ${formatToken(draftPrice, 6)} tUSDG today`
              : "Publish"}
        </button>
        {!ready && <p className="bq-basket-publish-note">Connect your wallet on Robinhood Chain testnet to publish.</p>}
        {errorAt("create")}
      </article>
    </section>
  );
}
