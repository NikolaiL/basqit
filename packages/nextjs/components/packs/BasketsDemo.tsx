"use client";

import { useState } from "react";
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
import { type Address, parseUnits } from "viem";
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
  const [shares, setShares] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<{ name: string; symbol: string; fee: string; dollars: Record<string, string> }>({
    name: "",
    symbol: "",
    fee: "0.5",
    dollars: {},
  });
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
  const sharesOf = (basket: Address) => {
    try {
      return parseUnits((shares[basket] ?? "").trim() || "0", 18);
    } catch {
      return 0n;
    }
  };

  /** Buys `amount` shares: each component bought exactly through the adapter, the creator fee within the budget. */
  const buy = async (basket: Address, amount: bigint, feeBps: bigint) => {
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
    const budget = spent + ceilDiv(spent * feeBps, 10_000n);
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

  // The create form: dollars of each company in one share become units at today's price.
  const draftParts = (listed.data ?? []).flatMap(({ token, price }) => {
    try {
      const dollars = parseUnits((draft.dollars[token] ?? "").trim() || "0", 6);
      return dollars > 0n && price > 0n ? [{ token, unitsPerShare: (dollars * ONE) / price }] : [];
    } catch {
      return [];
    }
  });
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
        {baskets.data?.rows.map(row => {
          const amount = sharesOf(row.basket);
          // Estimated cost, checked before the wallet opens; the router still enforces the exact budget.
          const shortOfUsdg =
            !!address && amount > 0n && usdgBalance !== undefined && usdgBalance < ceilDiv(row.perShare * amount, ONE);
          return (
            <article key={row.basket} className="bq-demo-card">
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
                <input
                  className="input input-sm"
                  inputMode="decimal"
                  placeholder="Shares, e.g. 1"
                  aria-label={`Shares of ${row.symbol}`}
                  value={shares[row.basket] ?? ""}
                  onChange={event => setShares(current => ({ ...current, [row.basket]: event.target.value }))}
                />
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!ready || !!busy || amount === 0n || shortOfUsdg}
                  onClick={() => act(`buy-${row.basket}`, () => buy(row.basket, amount, row.feeBps))}
                >
                  {busy === `buy-${row.basket}`
                    ? "Buying…"
                    : shortOfUsdg
                      ? "Not enough tUSDG"
                      : amount > 0n
                        ? `Buy ≈ ${formatToken(ceilDiv(row.perShare * amount, ONE), 6)} tUSDG`
                        : "Buy"}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={!ready || !!busy || amount === 0n || amount > row.balance}
                  onClick={() => act(`sell-${row.basket}`, () => sell(row.basket, amount, row.feeBps))}
                >
                  {busy === `sell-${row.basket}` ? "Selling…" : "Sell"}
                </button>
              </div>
              {shortOfUsdg && (
                <p className="bq-demo-note">
                  You have {formatToken(usdgBalance ?? 0n, 6)} tUSDG. Get free test USDG in step 3 above.
                </p>
              )}
              {errorAt(`buy-${row.basket}`)}
              {errorAt(`sell-${row.basket}`)}
            </article>
          );
        })}
      </div>

      <article className="bq-demo-card bq-demo-builder">
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
        <ul className="bq-demo-builder-rows">
          {listed.data?.map(({ token, price }) => {
            const info = label(token);
            const part = draftParts.find(entry => entry.token === token);
            return (
              <li key={token}>
                <StockLogo symbol={info?.ticker ?? ""} size={28} />
                <span>
                  <b>{info?.symbol ?? "…"}</b>
                  <small>
                    {`$${formatToken(price, 6)} each`}
                    {part && info && <em> · {`${formatToken(part.unitsPerShare, info.decimals)} a share`}</em>}
                  </small>
                </span>
                <input
                  className="input input-sm"
                  inputMode="decimal"
                  placeholder="$0"
                  aria-label={`Dollars of ${info?.symbol} in one share`}
                  value={draft.dollars[token] ?? ""}
                  onChange={event =>
                    setDraft(current => ({ ...current, dollars: { ...current.dollars, [token]: event.target.value } }))
                  }
                />
              </li>
            );
          })}
        </ul>
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
              setDraft({ name: "", symbol: "", fee: "0.5", dollars: {} });
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
    </section>
  );
}
