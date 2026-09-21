import { formatUnits, parseUnits } from "viem";

export const decimalPattern = /^\d+(\.\d{1,18})?$/;

export function tokenValue(balance: bigint, decimals: number, multiplier: bigint, bid: string, ask: string) {
  if (!decimalPattern.test(bid) || !decimalPattern.test(ask)) return null;
  const bidRaw = parseUnits(bid, 18);
  const askRaw = parseUnits(ask, 18);
  if (bidRaw <= 0n || askRaw < bidRaw || multiplier <= 0n) return null;
  return formatUnits((balance * multiplier * ((bidRaw + askRaw) / 2n)) / (10n ** BigInt(decimals) * 10n ** 18n), 18);
}

export function actionDate(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const { year, month, day } = value as Record<string, unknown>;
  if (![year, month, day].every(Number.isInteger)) return null;
  const date = new Date(Date.UTC(year as number, (month as number) - 1, day as number));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export function amount(value: string | null, digits = 4) {
  if (value === null) return "Unavailable";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Unavailable";
  if (number > 0 && number < 10 ** -digits) return `<${10 ** -digits}`;
  return number.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function money(value: string) {
  const number = Number(value);
  if (number > 0 && number < 0.01) return "<$0.01";
  return number.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function dividendHistory<T extends { symbol: string; type: string; date: string | null }>(
  events: T[],
  symbol: string,
): T[] {
  return events
    .filter(
      event =>
        event.symbol === symbol &&
        ["CORPORATE_ACTION_TYPE_CASH_DIVIDEND", "CORPORATE_ACTION_TYPE_STOCK_DIVIDEND"].includes(event.type),
    )
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

// Full reinvestment scenario, not a verified issuer calculation.
export function dividendEstimate(current: string, rate: string, bid: string, ask: string) {
  if (![current, rate, bid, ask].every(value => decimalPattern.test(value))) return null;
  const multiplier = parseUnits(current, 18);
  const price = tokenValue(10n ** 18n, 18, 10n ** 18n, bid, ask);
  if (multiplier <= 0n || price === null) return null;
  return {
    after: formatUnits(multiplier + (multiplier * parseUnits(rate, 18)) / parseUnits(price, 18), 18),
    price,
  };
}

// Display only: transaction amounts and editable inputs retain their original precision.
export function compactAmount(value: string | null) {
  if (value === null || value.trim() === "") return "Unavailable";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Unavailable";
  const rounded = number.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return rounded.replace(
    /0\.(0{4,})([1-9]\d*)$/,
    (_, zeros: string, digits: string) =>
      `0.0${String(zeros.length).replace(/\d/g, digit => "₀₁₂₃₄₅₆₇₈₉"[Number(digit)])}${digits}`,
  );
}
