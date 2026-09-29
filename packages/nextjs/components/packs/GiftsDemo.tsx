"use client";

import { useState } from "react";
import { deployment, ensureAllowance, formatToken, usePacksWrite, useTokens } from "./usePacks";
import { useQuery } from "@tanstack/react-query";
import { type Address, erc20Abi, formatUnits, isAddress, parseUnits } from "viem";
import { useAccount } from "wagmi";
import { StockLogo } from "~~/components/StockLogo";
import { packsClient, robinhoodTestnet } from "~~/services/packs/testnet";
import { getParsedError } from "~~/utils/scaffold-eth";

type Item = { token: Address; amount: bigint };

// Ready-made mixes: dollars per company, bought at the current price like any gift you build.
const MIXES = [
  { name: "Tech Giants", dollars: { AAPL: 7, AMZN: 7, META: 7 } },
  { name: "Chips & Cars", dollars: { NVDA: 12, TSLA: 7 } },
] as const;

/** A purchase deadline `minutes` from now, so a transaction stuck in a wallet cannot fill at an old price. */
const deadlineIn = (minutes: number) => BigInt(Math.floor(Date.now() / 1000) + minutes * 60);

export function GiftsDemo({ onError }: { onError: (message: string) => void }) {
  const { address, chainId } = useAccount();
  const write = usePacksWrite();
  const tokens = useTokens();
  const [friend, setFriend] = useState("");
  const [busy, setBusy] = useState("");
  // Custom gift: dollars per company when buying, token amounts when wrapping what you hold.
  const [mode, setMode] = useState<"buy" | "wrap">("buy");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const ready = !!address && chainId === robinhoodTestnet.id;

  const gifts = { address: deployment.gifts, abi: deployment.abis.gifts } as const;
  const router = { address: deployment.giftRouter, abi: deployment.abis.giftRouter } as const;
  const shop = useQuery({
    queryKey: ["packs-gift-shop", address],
    refetchInterval: 15_000,
    queryFn: async () => {
      const feeBps = (await packsClient.readContract({ ...router, functionName: "feeBps" })) as number;
      const rows = await Promise.all(
        deployment.stocks.map(async token => {
          const [price, stock, balance] = await Promise.all([
            packsClient.readContract({
              address: deployment.swapAdapter,
              abi: deployment.abis.swapAdapter,
              functionName: "priceUsdG",
              args: [token],
            }) as Promise<bigint>,
            packsClient.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [deployment.swapAdapter],
            }),
            address
              ? packsClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] })
              : Promise.resolve(0n),
          ]);
          return { token, price, stock, balance };
        }),
      );
      return { feeBps: BigInt(feeBps), rows };
    },
  });

  const act = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    onError("");
    try {
      await action();
    } catch (failure) {
      onError(getParsedError(failure));
    } finally {
      setBusy("");
    }
  };
  const recipient = (friend.trim() || address) as Address;
  const friendInvalid = !!friend.trim() && !isAddress(friend.trim());
  const rows = shop.data?.rows ?? [];
  const legCost = (token: Address, amount: bigint) => {
    const price = rows.find(entry => entry.token === token)?.price ?? 0n;
    return (amount * price + 10n ** 18n - 1n) / 10n ** 18n;
  };

  // Dollars become token amounts at the current price; wrap amounts are taken as typed.
  const itemsFrom = (values: Record<string, string>, as: "buy" | "wrap") =>
    rows.flatMap(({ token, price, stock, balance }) => {
      const raw = (values[token] ?? "").trim();
      const decimals = tokens.data?.[token.toLowerCase()]?.decimals ?? 18;
      let amount = 0n;
      try {
        amount =
          as === "buy"
            ? price > 0n
              ? (parseUnits(raw || "0", 6) * 10n ** 18n) / price
              : 0n
            : parseUnits(raw || "0", decimals);
      } catch {
        return [];
      }
      return amount > 0n ? [{ token, amount, over: as === "buy" ? amount > stock : amount > balance }] : [];
    });
  const totalOf = (items: Item[]) => {
    const spent = items.reduce((sum, item) => sum + legCost(item.token, item.amount), 0n);
    const fee = (spent * (shop.data?.feeBps ?? 0n) + 9_999n) / 10_000n;
    return { spent, fee, total: spent + fee };
  };
  const picked = itemsFrom(inputs, mode);
  const { total, fee } = totalOf(picked);
  const canBuild = ready && !friendInvalid && !busy && picked.length > 0 && picked.every(item => !item.over);
  const itemLabel = (item: Item) => {
    const token = tokens.data?.[item.token.toLowerCase()];
    return token ? `${formatToken(item.amount, token.decimals)} ${token.symbol}` : "…";
  };
  const tokenOf = (ticker: string) =>
    Object.values(tokens.data ?? {}).find(token => token.ticker === ticker && token.address !== deployment.usdg)
      ?.address;

  /** Buys the items through the router and seals them for the recipient, in one transaction. */
  const buy = async (items: Item[]) => {
    const { total: budget } = totalOf(items);
    await ensureAllowance(write, address!, deployment.usdg, deployment.giftRouter, budget);
    const purchases = items.map(item => ({
      token: item.token,
      amount: item.amount,
      adapter: deployment.swapAdapter,
      maxAmountIn: legCost(item.token, item.amount),
      routeData: "0x",
    }));
    const deadline = deadlineIn(20);
    // Pins the fee and the gifts contract the buyer saw, so neither can change under them.
    const maxFeeBps = Number(shop.data?.feeBps ?? 0n);
    await write({
      ...router,
      functionName: "buyGift",
      args: [purchases, budget, maxFeeBps, deployment.gifts, recipient, deadline],
    });
  };

  return (
    <section className="bq-demo-block">
      <h3>Gifts</h3>
      <p className="bq-demo-note">
        Stock Tokens bought at the current price and sealed in a gift. Buy one for yourself or send it to a friend.
      </p>
      <label className="bq-demo-friend">
        Send to a friend (optional)
        <input
          className="input"
          placeholder="0x… friend’s address"
          value={friend}
          onChange={event => setFriend(event.target.value)}
          aria-invalid={friendInvalid}
        />
      </label>
      <article className="bq-demo-card bq-demo-builder">
        <strong>Build your own</strong>
        <div className="bq-tabs" role="tablist" aria-label="How to fill the gift">
          <button
            role="tab"
            aria-selected={mode === "buy"}
            className={`btn btn-sm ${mode === "buy" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => (setMode("buy"), setInputs({}))}
          >
            Buy with tUSDG
          </button>
          <button
            role="tab"
            aria-selected={mode === "wrap"}
            className={`btn btn-sm ${mode === "wrap" ? "btn-primary" : "btn-secondary"}`}
            onClick={() => (setMode("wrap"), setInputs({}))}
          >
            Wrap tokens you hold
          </button>
        </div>
        <ul className="bq-demo-builder-rows">
          {rows
            .filter(entry => mode === "buy" || entry.balance > 0n)
            .map(({ token, price, balance }) => {
              const info = tokens.data?.[token.toLowerCase()];
              const item = picked.find(entry => entry.token === token);
              return (
                <li key={token}>
                  <StockLogo symbol={info?.ticker ?? ""} size={28} />
                  <span>
                    <b>{info?.symbol ?? "…"}</b>
                    {/* One line either way, so typing never makes the form taller. */}
                    <small>
                      {mode === "buy"
                        ? `$${Number(formatUnits(price, 6)).toFixed(2)} each`
                        : `You hold ${info ? formatToken(balance, info.decimals) : "…"}`}
                      {item &&
                        (item.over ? (
                          <em className="is-over">
                            {mode === "buy" ? " · not enough available" : " · more than you hold"}
                          </em>
                        ) : (
                          mode === "buy" && <em> · {itemLabel(item)}</em>
                        ))}
                    </small>
                  </span>
                  <input
                    className="input input-sm"
                    inputMode="decimal"
                    placeholder={mode === "buy" ? "$0" : "0"}
                    aria-label={mode === "buy" ? `Dollars of ${info?.symbol}` : `Amount of ${info?.symbol}`}
                    aria-invalid={item?.over}
                    value={inputs[token] ?? ""}
                    onChange={event => setInputs(current => ({ ...current, [token]: event.target.value }))}
                  />
                </li>
              );
            })}
        </ul>
        {mode === "wrap" && shop.data && !rows.some(entry => entry.balance > 0n) && (
          <p className="bq-demo-note">This wallet holds none of the listed Stock Tokens.</p>
        )}
        {mode === "buy" && fee > 0n && <p className="bq-demo-note">Includes a {formatToken(fee, 6)} tUSDG fee.</p>}
        <button
          className="btn btn-primary btn-sm"
          disabled={!canBuild}
          onClick={() =>
            act("custom", async () => {
              const items = picked.map(({ token, amount }) => ({ token, amount }));
              if (mode === "buy") await buy(items);
              else {
                for (const item of items)
                  await ensureAllowance(write, address!, item.token, deployment.gifts, item.amount);
                await write({ ...gifts, functionName: "wrap", args: [items, recipient] });
              }
              setInputs({});
            })
          }
        >
          {busy === "custom"
            ? "Sealing…"
            : mode === "buy"
              ? `${friend.trim() ? "Send" : "Buy"} for ${formatToken(total, 6)} tUSDG`
              : friend.trim()
                ? "Wrap and send"
                : "Wrap for yourself"}
        </button>
      </article>
      <div className="bq-demo-grid">
        {MIXES.map(mix => {
          const values = Object.fromEntries(
            Object.entries(mix.dollars).flatMap(([ticker, dollars]) => {
              const token = tokenOf(ticker);
              return token ? [[token, String(dollars)]] : [];
            }),
          );
          const items = itemsFrom(values, "buy");
          const price = totalOf(items).total;
          return (
            <article key={mix.name} className="bq-demo-card">
              <strong>{mix.name}</strong>
              <ul className="bq-demo-items">
                {items.map(item => (
                  <li key={item.token}>
                    <StockLogo symbol={tokens.data?.[item.token.toLowerCase()]?.ticker ?? ""} size={24} />
                    {itemLabel(item)}
                  </li>
                ))}
              </ul>
              <p className="bq-demo-price">{formatToken(price, 6)} tUSDG at today&apos;s prices</p>
              <button
                className="btn btn-primary btn-sm"
                disabled={!ready || friendInvalid || !!busy || !items.length || items.some(item => item.over)}
                onClick={() => act(`mix-${mix.name}`, () => buy(items.map(({ token, amount }) => ({ token, amount }))))}
              >
                {busy === `mix-${mix.name}` ? "Buying…" : friend.trim() ? "Send as a gift" : "Buy for yourself"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
