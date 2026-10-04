import { discoveryCatalog } from "~~/services/discover/catalog";
import { baseUrl } from "~~/utils/scaffold-eth/getMetadata";

export const dynamic = "force-dynamic";

// https://llmstxt.org: a plain index for AI assistants and answer engines.
export async function GET() {
  const assets = await discoveryCatalog().catch(() => []);
  const body = `# Basqit

> Basqit is an app for discovering and buying tokenized stocks (Stock Tokens) on Robinhood Chain, an Ethereum layer 2 (chain ID 4663). Type a mood, get a set of Stock Tokens, and trade them onchain for USDG from your own wallet. Early preview; not affiliated with or endorsed by Robinhood.

Stock Tokens are tokenized debt securities issued by Robinhood Assets (Jersey) Limited, backed 1:1 by the underlying share. They give economic exposure but no shareholder rights, and are not available to U.S. persons or residents of Canada, the UK and Switzerland. Dividends raise a token multiplier instead of paying cash.

## Pages

- [Tokenized stocks on Robinhood Chain](${baseUrl}/tokenized-stocks): how Stock Tokens work, FAQ, full list
- [Discover](${baseUrl}/discover): find tokenized stocks by mood or theme
- [Assets](${baseUrl}/atlas): every Stock Token with reference prices
- [Corporate events](${baseUrl}/corporate-events): dividends and multiplier changes

## Stock Tokens

${assets.map(a => `- [${a.symbol}: ${a.name}](${baseUrl}/tokenized-stocks/${a.symbol.toLowerCase()})`).join("\n")}
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
