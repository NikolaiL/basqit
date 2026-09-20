export type Holding = {
  symbol: string;
  name: string;
  address: `0x${string}`;
  balance: string;
  shareEquivalent: string | null;
  multiplier: string | null;
  valueUsd: string | null;
  priceAt: string | null;
};
export type Portfolio = {
  holdings: Holding[];
  blockNumber: string;
  fetchedAt: string;
  scanned: number;
  failed: number;
  totalUsd: string;
  unpriced: number;
};
export type CorporateAction = {
  id: string;
  symbol: string;
  type: string;
  status: string;
  date: string | null;
  rate: string | null;
  multiplierBefore: string | null;
  multiplierAfter: string | null;
  onchain?: {
    status: "correlated" | "unmatched" | "unavailable";
    transactionHash?: string;
    effectiveAt?: string;
    blockNumber?: string;
  };
  projection?: {
    source: "issuer" | "estimate";
    current: string;
    after: string;
    effectiveAt: string | null;
    price: string | null;
    priceAt: string | null;
  };
  oldRate: string | null;
  newRate: string | null;
};
export type ActionsResponse = { actions: CorporateAction[]; fetchedAt: string };
