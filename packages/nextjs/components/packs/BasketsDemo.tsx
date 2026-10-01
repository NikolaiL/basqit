"use client";

import { useState } from "react";
import { BasketTradeDialog } from "./BasketTradeDialog";
import {
  deadlineIn,
  demoError,
  deployment,
  ensureAllowance,
  formatToken,
  usePacksWrite,
  useTestUsdg,
  useTokens,
} from "./usePacks";
import { useQuery } from "@tanstack/react-query";
import { type Address, formatUnits, parseUnits } from "viem";
import { useAccount } from "wagmi";
import { StockLogo } from "~~/components/StockLogo";
import { packsClient, robinhoodTestnet, testnetAssets } from "~~/services/packs/testnet";

type Part = { token: Address; unitsPerShare: bigint };

const ONE = 10n ** 18n;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export function BasketsDemo() {
  const { address, chainId } = useAccount();
  const write = usePacksWrite();
  const tokens = useTokens();
  const [busy, setBusy] = useState("");
  const [trading, setTrading] = useState<{ basket: Address; side: "buy" | "sell" }>();
  // Stock amounts are what the basket stores; dollars are only a way to type them at today's price.
  const [draft, setDraft] = useState<{ name: string; symbol: string; fee: string; units: Record<string, string> }>({
    name: "",
    symbol: "",
    fee: "0.5",
    units: {},
  });
  const [typingUsd, setTypingUsd] = useState<{ token: Address; text: string }>();
  const ready = !!address && chainId === robinhoodTestnet.id;
  const factory = { address: deployment.factory, abi: deployment.abis.factory } as const;
  const shop = { address: deployment.swapAdapter, abi: deployment.abis.swapAdapter } as const;
  const priceOf = (token: Address) =>
    packsClient.readContract({ ...shop, functionName: "priceUsdG", args: [token] }) as Promise<bigint>;

  const baskets = useQuery({
    queryKey: ["packs-baskets", address],
    refetchInterval: 15_000,
    queryFn: async () => {
      const [list, feesOn] = (await Promise.all([
        packsClient.readContract({ ...factory, functionName: "allBaskets" }),
        packsClient.readContract({ ...factory, functionName: "feesEnabled" }),
      ])) as [Address[], boolean];
      const rows = await Promise.all(
        list.map(async basket => {
          const b = { address: basket, abi: deployment.abis.basket } as const;
          const [name, symbol, parts, supply, balance, fee] = await Promise.all([
            packsClient.readContract({ ...b, functionName: "name" }) as Promise<string>,
            packsClient.readContract({ ...b, functionName: "symbol" }) as Promise<string>,
            packsClient.readContract({ ...b, functionName: "components" }) as Promise<Part[]>,
            packsClient.readContract({ ...b, functionName: "totalSupply" }) as Promise<bigint>,
            address
              ? (packsClient.readContract({ ...b, functionName: "balanceOf", args: [address] }) as Promise<bigint>)
              : Promise.resolve(0n),
            packsClient.readContract({ ...factory, functionName: "creatorFee", args: [basket] }) as Promise<
              readonly [Address, number]
            >,
          ]);
          const prices = await Promise.all(parts.map(part => priceOf(part.token)));
          const perShare = parts.reduce((sum, part, i) => sum + ceilDiv(part.unitsPerShare * prices[i], ONE), 0n);
          return { basket, name, symbol, parts, supply, balance, feeBps: BigInt(fee[1]), perShare };
        }),
      );
      return { rows, feesOn };
    },
  });

  // Every stock the factory lists, with its current price, for the create form.
  const listed = useQuery({
    queryKey: ["packs-basket-listed"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { stocks } = await testnetAssets();
      return Promise.all(stocks.map(async token => ({ token, price: await priceOf(token) })));
    },
  });

  // The last failure and the action it belongs to, shown right under that action.
  const [failed, setFailed] = useState<{ at: string; message: string }>();
  const usdgBalance = useTestUsdg(address).data;
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

  /** The swap legs that buy `amount` shares, and what they cost with the creator fee. */
  const buyLegs = async (basket: Address, amount: bigint, feeBps: bigint) => {
    const b = { address: basket, abi: deployment.abis.basket } as const;
    const [parts, needed] = (await Promise.all([
      packsClient.readContract({ ...b, functionName: "components" }),
      packsClient.readContract({ ...b, functionName: "quoteMint", args: [amount] }),
    ])) as [Part[], bigint[]];
    const legs = await Promise.all(
      parts.map(async (part, i) => ({
        adapter: deployment.swapAdapter,
        maxAmountIn: (await packsClient.readContract({
          ...shop,
          functionName: "quote",
          args: [part.token, needed[i]],
        })) as bigint,
        routeData: "0x" as const,
      })),
    );
    const spent = legs.reduce((sum, leg) => sum + leg.maxAmountIn, 0n);
    return { legs, cost: spent + ceilDiv(spent * feeBps, 10_000n) };
  };

  /**
   * Spends up to `budget` tUSDG on as many shares as it buys, to 6 decimals. Each component is bought exactly
   * through the adapter; the router refunds whatever the purchase does not use.
   */
  const buy = async (basket: Address, budget: bigint, perShare: bigint, feeBps: bigint) => {
    const step = 10n ** 12n;
    let amount = ((budget * 10_000n * ONE) / ((10_000n + feeBps) * perShare) / step) * step;
    let quote = await buyLegs(basket, amount, feeBps);
    // Per-component rounding can cost a little more than the estimate; shrink to fit, at most a few times.
    for (let tries = 0; quote.cost > budget && tries < 3; tries++) {
      amount = ((amount * budget) / quote.cost / step) * step;
      quote = await buyLegs(basket, amount, feeBps);
    }
    if (amount === 0n || quote.cost > budget) throw new Error("That amount buys less than 0.000001 of a share.");
    const { legs } = quote;
    const { usdg } = await testnetAssets();
    await ensureAllowance(write, address!, usdg, deployment.purchaseRouter, budget);
    await write({
      address: deployment.purchaseRouter,
      abi: deployment.abis.purchaseRouter,
      functionName: "buyBasket",
      args: [basket, amount, budget, legs, address, deadlineIn(20)],
    });
  };

  /** Sells `amount` shares: redeems in kind and sells each component, with the fee taken from what comes back. */
  const sell = async (basket: Address, amount: bigint, feeBps: bigint) => {
    const b = { address: basket, abi: deployment.abis.basket } as const;
    const [parts, out] = (await Promise.all([
      packsClient.readContract({ ...b, functionName: "components" }),
      packsClient.readContract({ ...b, functionName: "quoteRedeem", args: [amount] }),
    ])) as [Part[], bigint[]];
    const legs = await Promise.all(
      parts.map(async (part, i) => ({
        adapter: deployment.swapAdapter,
        minAmountOut: (out[i] * (await priceOf(part.token))) / ONE,
        routeData: "0x" as const,
      })),
    );
    const received = legs.reduce((sum, leg) => sum + leg.minAmountOut, 0n);
    const minUsdGOut = received - ceilDiv(received * feeBps, 10_000n);
    await ensureAllowance(write, address!, basket, deployment.sellRouter, amount);
    await write({
      address: deployment.sellRouter,
      abi: deployment.abis.sellRouter,
      functionName: "sellBasket",
      args: [basket, amount, minUsdGOut, legs, address, deadlineIn(20)],
    });
  };

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
    draft.name.trim().length > 0 &&
    draft.symbol.trim().length > 0 &&
    draftParts.length > 0 &&
    feeBps >= 0 &&
    feeBps <= 100;

  return (
    <section className="bq-demo-block">
      <h3>Baskets</h3>
      <p className="bq-demo-note">
        Each share holds fixed amounts of test Stock Tokens. Buying purchases every component at today&apos;s price and
        mints the share; selling redeems it and sells the components.
        {baskets.data && !baskets.data.feesOn && " Creator fees are switched off on testnet."}
      </p>
      <div className="bq-demo-grid">
        {baskets.data?.rows.map(row => (
          <article key={row.basket} className="bq-demo-card bq-basket-card">
            <strong>
              {row.name} <small>{row.symbol}</small>
            </strong>
            <ul className="bq-demo-items">
              {row.parts.map(part => (
                <li key={part.token}>
                  <StockLogo symbol={label(part.token)?.ticker ?? ""} size={24} />
                  {label(part.token)
                    ? `${formatToken(part.unitsPerShare, label(part.token)!.decimals)} ${label(part.token)!.symbol}`
                    : "…"}
                </li>
              ))}
            </ul>
            <p className="bq-demo-price">
              {formatToken(row.perShare, 6)} tUSDG a share · {formatToken(row.supply, 18)} shares out
              {row.balance > 0n && ` · you hold ${formatToken(row.balance, 18)}`}
            </p>
            <div className="bq-demo-row">
              <button
                className="btn btn-primary btn-sm"
                disabled={!!busy}
                onClick={() => setTrading({ basket: row.basket, side: "buy" })}
              >
                Buy
              </button>
              <button
                className="btn btn-secondary btn-sm"
                disabled={!!busy || row.balance === 0n}
                onClick={() => setTrading({ basket: row.basket, side: "sell" })}
              >
                Sell
              </button>
            </div>
          </article>
        ))}
      </div>

      <article className="bq-demo-card bq-demo-builder bq-basket-builder">
        <strong>Create a basket</strong>
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
        <label className="bq-demo-friend">
          Your creator fee on every buy and sell, in % (up to 1)
          <input
            className="input input-sm"
            inputMode="decimal"
            aria-label="Creator fee in percent"
            value={draft.fee}
            onChange={event => setDraft(current => ({ ...current, fee: event.target.value }))}
          />
        </label>
        <button
          className="btn btn-primary btn-sm"
          disabled={!canCreate}
          onClick={() =>
            act("create", async () => {
              await write({
                ...factory,
                functionName: "createBasket",
                args: [draft.name.trim(), draft.symbol.trim(), draftParts, feeBps],
              });
              setDraft({ name: "", symbol: "", fee: "0.5", units: {} });
            })
          }
        >
          {busy === "create"
            ? "Publishing…"
            : draftParts.length
              ? `Publish · one share ≈ ${formatToken(draftPrice, 6)} tUSDG today`
              : "Publish"}
        </button>
        {errorAt("create")}
      </article>
      {(() => {
        const row = baskets.data?.rows.find(entry => entry.basket === trading?.basket);
        if (!row || !trading) return null;
        // Fees switched off on testnet are not charged, so they are not estimated either.
        const feeBps = baskets.data?.feesOn ? row.feeBps : 0n;
        return (
          <BasketTradeDialog
            key={`${row.basket}-${trading.side}`}
            basket={{ symbol: row.symbol, name: row.name, perShare: row.perShare, feeBps, shares: row.balance }}
            initialSide={trading.side}
            usdg={usdgBalance}
            onBuy={budget => buy(row.basket, budget, row.perShare, feeBps)}
            onSell={amount => sell(row.basket, amount, feeBps)}
            onClose={() => setTrading(undefined)}
          />
        );
      })()}
    </section>
  );
}
