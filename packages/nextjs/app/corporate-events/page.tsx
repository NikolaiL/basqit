import { PortfolioDashboard } from "~~/components/portfolio/PortfolioDashboard";

export const metadata = {
  title: "Tokenized Stock Dividends and Corporate Events",
  description:
    "Dividends and corporate actions for Stock Tokens on Robinhood Chain, and how each one changes the token multiplier.",
  alternates: { canonical: "/corporate-events" },
};

export default async function CorporateEventsPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const params = await searchParams;
  const token =
    typeof params.token === "string" && /^[A-Za-z0-9.\-]{1,20}$/.test(params.token) ? params.token.toUpperCase() : "";
  return <PortfolioDashboard key={token} page="events" initialToken={token} />;
}
