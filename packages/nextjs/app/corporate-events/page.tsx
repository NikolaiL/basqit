import { PortfolioDashboard } from "~~/components/portfolio/PortfolioDashboard";

export const metadata = { title: "Corporate events" };

export default async function CorporateEventsPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const params = await searchParams;
  const token =
    typeof params.token === "string" && /^[A-Za-z0-9.\-]{1,20}$/.test(params.token) ? params.token.toUpperCase() : "";
  return <PortfolioDashboard key={token} page="events" initialToken={token} />;
}
