import { compactAmount } from "~~/services/portfolio/format";

export function TokenAmount({ value }: { value: string | null }) {
  return (
    <span className="bq-token-amount" title={value ?? undefined} aria-label={value ?? "Unavailable"}>
      {compactAmount(value)}
    </span>
  );
}
