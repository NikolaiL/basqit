import { Bricolage_Grotesque, IBM_Plex_Mono } from "next/font/google";
import "@rainbow-me/rainbowkit/styles.css";
import "@scaffold-ui/components/styles.css";
import { AnalyticsScripts } from "~~/components/AnalyticsScripts";
import { ScaffoldEthAppWithProviders } from "~~/components/ScaffoldEthAppWithProviders";
import { ThemeProvider } from "~~/components/ThemeProvider";
import "~~/styles/globals.css";
import { baseUrl, getMetadata } from "~~/utils/scaffold-eth/getMetadata";

export const dynamic = "force-dynamic";

const display = Bricolage_Grotesque({ subsets: ["latin"], axes: ["wdth", "opsz"], variable: "--bq-display" });
// Receipt-style purchase summaries.
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--bq-mono" });

export const metadata = getMetadata({
  title: "Basqit: Tokenized Stocks on Robinhood Chain",
  description:
    "Discover and buy tokenized stocks on Robinhood Chain. Type a mood, get a set of Stock Tokens, and trade them onchain from your own wallet.",
});

const siteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Basqit",
  url: baseUrl,
  description: "Discover and buy tokenized stocks on Robinhood Chain.",
};

const ScaffoldEthApp = ({ children }: { children: React.ReactNode }) => {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <AnalyticsScripts />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }} />
        <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
          <ScaffoldEthAppWithProviders>{children}</ScaffoldEthAppWithProviders>
        </ThemeProvider>
      </body>
    </html>
  );
};

export default ScaffoldEthApp;
