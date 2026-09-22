"use client";

import { FundingPanel } from "./FundingPanel";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { useTradeBalance } from "~~/hooks/scaffold-eth/useStockTrade";
import { NATIVE } from "~~/services/funding/shared";

export function GasFundingNotice({
  showAction = true,
  disabled = false,
  onOpenChange,
  required,
}: {
  showAction?: boolean;
  disabled?: boolean;
  required?: bigint;
  onOpenChange?: (open: boolean) => void;
}) {
  const { address } = useAccount();
  const gas = useTradeBalance(NATIVE, address && isAddress(address) ? (address as `0x${string}`) : undefined);
  if (!gas.data || (gas.data.balance > 0n && (required === undefined || gas.data.balance >= required))) return null;
  return (
    <div className="bq-gas-notice" role="status">
      <p>
        You need more ETH on Robinhood Chain for network fees. Start with around $1–2; choose your amount. Network fees
        vary.
      </p>
      {showAction && (
        <FundingPanel destination="ETH" triggerLabel="Get ETH" disabled={disabled} onOpenChange={onOpenChange} />
      )}
    </div>
  );
}
