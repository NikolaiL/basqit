import { actionDate, decimalPattern, dividendEstimate, tokenValue } from "./format";
import { matchMultiplier } from "./multiplier-history";
import { readMultiplierHistory } from "./multiplier-rpc";
import type { ActionsResponse, CorporateAction, Holding, Portfolio } from "./types";
import { type Address, formatUnits, isAddress, parseUnits } from "viem";
import { stockTokenContract } from "~~/contracts/externalContracts";
import { atlasClient } from "~~/services/atlas/client";

const ORIGIN = "https://api.robinhood.com/rhj";
const CHAIN_ID = 4663;

async function readJson(path: string, revalidate: number): Promise<Record<string, unknown>> {
  const response = await fetch(`${ORIGIN}/${path}`, { next: { revalidate }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error("Stock Token data is temporarily unavailable. Please try again.");
  const data = await response.json();
  if (!data || typeof data !== "object") throw new Error("Unexpected Stock Token response.");
  return data;
}

const string = (value: unknown) => (typeof value === "string" ? value : "");
const decimal = (value: unknown) => (typeof value === "string" && decimalPattern.test(value) ? value : null);

export async function getActions(): Promise<ActionsResponse> {
  const payload = await readJson("corporate-actions", 3600);
  if (!Array.isArray(payload.corpActions)) throw new Error("Corporate events are temporarily unavailable.");
  const actions: CorporateAction[] = payload.corpActions.flatMap(row => {
    if (!row || typeof row !== "object" || !string(row.tokenSymbol) || !string(row.id)) return [];
    if (!Array.isArray(row.deployments) || !row.deployments.some((d: { chainId?: number }) => d?.chainId === CHAIN_ID))
      return [];
    const variants: Record<string, string> = {
      CORPORATE_ACTION_TYPE_CASH_DIVIDEND: "cashDividend",
      CORPORATE_ACTION_TYPE_STOCK_DIVIDEND: "stockDividend",
      CORPORATE_ACTION_TYPE_FORWARD_SPLIT: "forwardSplit",
      CORPORATE_ACTION_TYPE_REVERSE_SPLIT: "reverseSplit",
    };
    const detail = row.details?.[variants[row.type]];
    return [
      {
        id: row.id,
        symbol: row.tokenSymbol,
        type: string(row.type),
        status: string(row.status),
        date: actionDate(row.processDate),
        rate: decimal(detail?.rate),
        // The REST feed supplies dividend/split rates, not event-specific multipliers.
        multiplierBefore: null,
        multiplierAfter: null,
        oldRate: decimal(detail?.oldRate),
        newRate: decimal(detail?.newRate),
      },
    ];
  });
  const deployments = new Map<string, `0x${string}`>();
  for (const row of payload.corpActions) {
    const address = row?.deployments?.find((d: { chainId?: number }) => d?.chainId === CHAIN_ID)?.contractAddress;
    if (typeof address === "string" && isAddress(address))
      deployments.set(row.id, address.toLowerCase() as `0x${string}`);
  }
  const completed = actions.filter(action => action.status === "CORPORATE_ACTION_STATUS_COMPLETED");
  try {
    const addresses = [
      ...new Set(completed.flatMap(action => (deployments.get(action.id) ? [deployments.get(action.id)!] : []))),
    ].sort();
    const history = addresses.length ? await readMultiplierHistory(addresses) : [];
    for (const action of completed) {
      const address = deployments.get(action.id);
      const match = address
        ? matchMultiplier(
            action,
            actions.filter(peer => deployments.get(peer.id) === address),
            history.filter(log => log.address === address),
          )
        : undefined;
      action.onchain = { status: address ? "unmatched" : "unavailable" };
      if (match) {
        action.multiplierBefore = match.before;
        action.multiplierAfter = match.after;
        action.onchain = {
          status: "correlated",
          transactionHash: match.transactionHash,
          effectiveAt: match.effectiveAt,
          blockNumber: match.blockNumber,
        };
      }
    }
  } catch {
    for (const action of completed) action.onchain = { status: "unavailable" };
  }
  // Optional projections must not hide corporate events during a catalog/price outage.
  try {
    const catalog = await readJson("assets", 300);
    if (Array.isArray(catalog.assets)) {
      await Promise.all(
        actions.map(async action => {
          if (action.status !== "CORPORATE_ACTION_STATUS_IN_PROGRESS") return;
          const raw = payload.corpActions as Record<string, any>[];
          const row = raw.find(item => item.id === action.id);
          const address = row?.deployments?.find((d: any) => d?.chainId === CHAIN_ID)?.contractAddress;
          if (typeof address !== "string" || !isAddress(address)) return;
          const asset = (catalog.assets as Record<string, any>[]).find(
            item =>
              item?.tokenSymbol === action.symbol &&
              Array.isArray(item.deployments) &&
              item.deployments.some(
                (d: any) =>
                  d?.chainId === CHAIN_ID &&
                  typeof d.contractAddress === "string" &&
                  d.contractAddress.toLowerCase() === address.toLowerCase(),
              ),
          );
          const current = decimal(asset?.currentMultiplier);
          if (!current || parseUnits(current, 18) <= 0n) return;
          const scheduled = decimal(asset?.pendingMultiplier);
          const effectiveAt = string(asset?.pendingMultiplierEffectiveTime);
          if (scheduled && parseUnits(scheduled, 18) > 0n) {
            // This is the token's announced schedule, not a verified join to this action.
            if (Date.parse(effectiveAt) > Date.now())
              action.projection = {
                source: "issuer",
                current,
                after: scheduled,
                effectiveAt,
                price: null,
                priceAt: null,
              };
            return;
          }
          if (action.type !== "CORPORATE_ACTION_TYPE_CASH_DIVIDEND" || action.rate === null) return;
          if (!/^[A-Za-z0-9.\-]{1,20}$/.test(action.symbol)) return;
          try {
            const prices = await readJson(`prices/${encodeURIComponent(action.symbol)}`, 15);
            const quote = Array.isArray(prices.quotes)
              ? prices.quotes.find(
                  q =>
                    q?.tokenSymbol === action.symbol &&
                    q.currency === "USD" &&
                    Array.isArray(q.deployments) &&
                    q.deployments.some(
                      (d: any) =>
                        d?.chainId === CHAIN_ID &&
                        typeof d.contractAddress === "string" &&
                        d.contractAddress.toLowerCase() === address.toLowerCase(),
                    ),
                )
              : null;
            const priceAt = string(quote?.generatedAt);
            if (!Number.isFinite(Date.parse(priceAt))) return;
            const estimate = dividendEstimate(current, action.rate, string(quote?.bid), string(quote?.ask));
            if (estimate)
              action.projection = {
                source: "estimate",
                current,
                ...estimate,
                effectiveAt: null,
                priceAt,
              };
          } catch {
            /* A missing quote leaves the estimate unavailable. */
          }
        }),
      );
    }
  } catch {
    /* The corporate-action feed remains usable without projections. */
  }
  actions.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return { actions, fetchedAt: new Date().toISOString() };
}

export async function getPortfolio(owner: Address): Promise<Portfolio> {
  const payload = await readJson("assets", 300);
  if (!Array.isArray(payload.assets) || payload.assets.length === 0)
    throw new Error("The asset catalog is unavailable.");
  const seen = new Set<string>();
  const assets = payload.assets.flatMap(row => {
    if (!row || typeof row !== "object") return [];
    const deployment = Array.isArray(row.deployments)
      ? row.deployments.find((d: { chainId?: number }) => d?.chainId === CHAIN_ID)
      : null;
    if (!isAddress(deployment?.contractAddress ?? "") || !/^[A-Za-z0-9.\-]{1,20}$/.test(string(row.tokenSymbol)))
      return [];
    const address = deployment.contractAddress as `0x${string}`;
    if (seen.has(address.toLowerCase())) return [];
    seen.add(address.toLowerCase());
    return [
      {
        address,
        symbol: row.tokenSymbol as string,
        name: string(row.tokenName).replace(/\s*•\s*Robinhood Token$/, ""),
      },
    ];
  });
  if (!assets.length) throw new Error("No readable assets were returned by the catalog.");
  const blockNumber = await atlasClient.getBlockNumber();
  const holdings: Holding[] = [];
  let failed = payload.assets.length - assets.length;
  // Bounded batches keep public RPC requests small; balances share one block snapshot.
  for (let start = 0; start < assets.length; start += 24) {
    const batch = assets.slice(start, start + 24);
    const results = await atlasClient.multicall({
      contracts: batch.map(asset => ({
        ...stockTokenContract(asset.address),
        functionName: "balanceOf" as const,
        args: [owner] as const,
      })),
      blockNumber,
    });
    for (let i = 0; i < batch.length; i++) {
      const result = results[i];
      if (result.status !== "success") {
        failed++;
        continue;
      }
      if (result.result === 0n) continue;
      const asset = batch[i];
      const contract = stockTokenContract(asset.address);
      const metadata = await atlasClient.multicall({
        contracts: [
          { ...contract, functionName: "decimals" },
          { ...contract, functionName: "uiMultiplier" },
        ],
        blockNumber,
      });
      if (metadata[0].status !== "success") {
        failed++;
        continue;
      }
      const decimals = metadata[0].result;
      const multiplier = metadata[1].status === "success" && metadata[1].result > 0n ? metadata[1].result : null;
      let valueUsd: string | null = null;
      let priceAt: string | null = null;
      try {
        const prices = await readJson(`prices/${encodeURIComponent(asset.symbol)}`, 15);
        const quote = Array.isArray(prices.quotes)
          ? prices.quotes.find(
              q =>
                q?.tokenSymbol === asset.symbol &&
                q.currency === "USD" &&
                Array.isArray(q.deployments) &&
                q.deployments.some(
                  (d: { chainId?: number; contractAddress?: string }) =>
                    d?.chainId === CHAIN_ID && d.contractAddress?.toLowerCase() === asset.address.toLowerCase(),
                ),
            )
          : null;
        if (
          quote &&
          multiplier !== null &&
          typeof quote.generatedAt === "string" &&
          Number.isFinite(Date.parse(quote.generatedAt))
        ) {
          priceAt = quote.generatedAt;
          valueUsd = tokenValue(result.result, decimals, multiplier, string(quote.bid), string(quote.ask));
        }
      } catch {
        /* A price outage must not hide an onchain holding. */
      }
      holdings.push({
        ...asset,
        balance: formatUnits(result.result, decimals),
        multiplier: multiplier === null ? null : formatUnits(multiplier, 18),
        shareEquivalent: multiplier === null ? null : formatUnits(result.result * multiplier, decimals + 18),
        valueUsd,
        priceAt,
      });
    }
  }
  holdings.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    holdings,
    blockNumber: blockNumber.toString(),
    fetchedAt: new Date().toISOString(),
    scanned: assets.length,
    failed,
    totalUsd: formatUnits(
      holdings.reduce((sum, h) => sum + (h.valueUsd === null ? 0n : parseUnits(h.valueUsd, 18)), 0n),
      18,
    ),
    unpriced: holdings.filter(h => h.valueUsd === null).length,
  };
}
