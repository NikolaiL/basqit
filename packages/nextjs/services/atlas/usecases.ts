import type { UniverseRow } from "./types";

/**
 * The eight use cases named in Robinhood's "Building with Stock Tokens" guide.
 *
 * They are modelled as gates rather than as eight independent features, because that is what the
 * data shows: seven of the eight are blocked by the same single requirement — a price — and the
 * guide is explicit that baskets are valued from each token's feed.
 *
 * A price can come from two sources with very different properties, so each gate reports both:
 *
 *  - **any source** — a Chainlink feed or a non-empty AMM pool
 *  - **feed-backed** — the official, auditable reference only
 *
 * The gap between the two columns is the interesting number, not either one alone.
 */
export type UseCaseId =
  | "trading"
  | "display"
  | "lending"
  | "baskets"
  | "yield"
  | "thresholds"
  | "perps"
  | "globalAccess";

export type UseCase = {
  id: UseCaseId;
  /** Short label for the per-row badge. */
  short: string;
  /** Full name as the guide gives it. */
  label: string;
  /** Requires a price, from any source. */
  needsPrice: boolean;
  /** Requires fractional trading. */
  needsFractional: boolean;
  /** What the guide says the product looks like. */
  example: string;
};

export const USE_CASES: UseCase[] = [
  {
    id: "trading",
    short: "Trade",
    label: "Trading",
    needsPrice: false,
    needsFractional: false,
    example: "RFQ swap interfaces, priced by the venue",
  },
  {
    id: "display",
    short: "Display",
    label: "Portfolio & display",
    needsPrice: true,
    needsFractional: false,
    example: "Balances with live USD value and daily P&L",
  },
  {
    id: "lending",
    short: "Lending",
    label: "Lending & borrowing",
    needsPrice: true,
    needsFractional: false,
    example: "Deposit as collateral and borrow USDG",
  },
  {
    id: "baskets",
    short: "Baskets",
    label: "Indices & baskets",
    needsPrice: true,
    needsFractional: true,
    example: "A themed bundle that auto-values from each token's feed",
  },
  {
    id: "yield",
    short: "Yield",
    label: "Yield strategies",
    needsPrice: true,
    needsFractional: false,
    example: "A vault supplying tokens to a lending market",
  },
  {
    id: "thresholds",
    short: "Threshold",
    label: "Price-aware contracts",
    needsPrice: true,
    needsFractional: false,
    example: "Logic that fires when a token crosses a price",
  },
  {
    id: "perps",
    short: "Perps",
    label: "Perps & derivatives",
    needsPrice: true,
    needsFractional: false,
    example: "Equity-backed margin or underlying",
  },
  {
    id: "globalAccess",
    short: "Global",
    label: "Global access",
    needsPrice: true,
    needsFractional: false,
    example: "Equity exposure in eligible regions",
  },
];

/** The subset that cannot be built without a price. */
export const PRICE_GATED = USE_CASES.filter(useCase => useCase.needsPrice);

type PriceShape = Pick<UniverseRow, "feed" | "pool" | "fractional">;

const hasAnyPrice = (row: PriceShape): boolean => row.feed !== null || row.pool !== null;

const hasFeed = (row: PriceShape): boolean => row.feed !== null;

const isFractional = (row: PriceShape): boolean => row.fractional === "tradable";

const passes = (row: PriceShape, useCase: UseCase, priceTest: (row: PriceShape) => boolean): boolean =>
  (!useCase.needsPrice || priceTest(row)) && (!useCase.needsFractional || isFractional(row));

/** Whether a token can serve a use case using any price source. */
export const supports = (row: PriceShape, useCase: UseCase): boolean => passes(row, useCase, hasAnyPrice);

/** Whether a token can serve a use case on the official feed alone. */
export const supportsFeedBacked = (row: PriceShape, useCase: UseCase): boolean => passes(row, useCase, hasFeed);

/** The use cases a token can serve today, in declaration order. */
export const supportedUseCases = (row: PriceShape): UseCaseId[] =>
  USE_CASES.filter(useCase => supports(row, useCase)).map(useCase => useCase.id);

/** The subset of those that can also be served on the official feed. */
export const feedBackedUseCases = (row: PriceShape): UseCaseId[] =>
  USE_CASES.filter(useCase => supportsFeedBacked(row, useCase)).map(useCase => useCase.id);

export type UseCaseCoverage = {
  useCase: UseCase;
  /** Tokens that can serve it with a feed or a pool. */
  anySource: number;
  /** Tokens that can serve it on the official feed alone. */
  feedBacked: number;
  total: number;
  blockedBy: string | null;
};

/**
 * How many tokens can serve each use case, under both price assumptions.
 *
 * Reporting both is the point: the same use case can be "yes for 104 tokens" or "yes for 35",
 * depending on whether a derived pool price is acceptable. That is a risk decision, not a
 * formatting choice, so it is not collapsed into one number.
 */
export const calculateUseCaseCoverage = (rows: PriceShape[]): UseCaseCoverage[] =>
  USE_CASES.map(useCase => ({
    useCase,
    anySource: rows.filter(row => supports(row, useCase)).length,
    feedBacked: rows.filter(row => supportsFeedBacked(row, useCase)).length,
    total: rows.length,
    blockedBy: useCase.needsFractional ? "price and fractional trading" : useCase.needsPrice ? "price" : null,
  }));
