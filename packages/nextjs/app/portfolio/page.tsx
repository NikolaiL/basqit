import { PortfolioDashboard } from "~~/components/portfolio/PortfolioDashboard";

// Wallet-specific: nothing here for search engines.
export const metadata = { title: "Portfolio", robots: { index: false } };

export default function PortfolioPage() {
  return <PortfolioDashboard />;
}
