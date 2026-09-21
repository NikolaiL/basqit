"use client";

import { formatUnits, isAddress } from "viem";
import { TokenAmount } from "~~/components/TokenAmount";
import { useTradeBalance } from "~~/hooks/scaffold-eth/useStockTrade";
import { USDG } from "~~/services/trading/quote";

export function USDGBalance({ address }: { address: string }) {
  const balance = useTradeBalance(USDG, isAddress(address) ? (address as `0x${string}`) : undefined);
  return (
    <span className="bq-usdg-balance" title="USDG balance on Robinhood Chain">
      {balance.data ? (
        <TokenAmount value={formatUnits(balance.data.balance, balance.data.decimals)} />
      ) : balance.isError ? (
        "Unavailable"
      ) : (
        "Loading…"
      )}{" "}
      USDG
    </span>
  );
}
