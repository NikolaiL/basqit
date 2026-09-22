export type DiscoveryMatch = { symbol: string; score: number };

export function normalizeTheme(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const theme = value.trim().replace(/\s+/g, " ");
  return theme.length >= 1 && theme.length <= 180 ? theme : null;
}

export function exactSymbolMatches(theme: string, symbols: string[]): DiscoveryMatch[] {
  const query = theme.trim().replace(/^\$/, "").toUpperCase();
  return symbols.filter(symbol => symbol.toUpperCase() === query).map(symbol => ({ symbol, score: 3 }));
}

export function selectMatches(payload: unknown, symbols: string[]): DiscoveryMatch[] {
  if (!payload || typeof payload !== "object" || !("answers" in payload)) throw new Error("Invalid Jev response");
  const answers = payload.answers as Record<string, unknown>;
  if (!answers || typeof answers !== "object") throw new Error("Invalid Jev answers");
  const matches: DiscoveryMatch[] = [];
  for (const symbol of symbols) {
    const answer = answers[symbol] as { type?: string; score?: number; confidence?: number } | undefined;
    if (
      !answer ||
      answer.type !== "score" ||
      typeof answer.score !== "number" ||
      !Number.isFinite(answer.score) ||
      answer.score < 0 ||
      answer.score > 3 ||
      typeof answer.confidence !== "number" ||
      !Number.isFinite(answer.confidence) ||
      answer.confidence < 0 ||
      answer.confidence > 1
    )
      throw new Error("Incomplete Jev answers");
    if (answer.score >= 2.4 && answer.confidence >= 0.5) matches.push({ symbol, score: answer.score });
  }
  return matches.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol)).slice(0, 8);
}

// Only plain random requests bypass thematic scoring; "random AI tokens" still goes to Jev.
export function randomTokenCount(theme: string): number | null {
  const match = theme
    .toLowerCase()
    .match(
      /^(?:(?:please\s+)?(?:show me|give me|pick|select)\s+|(?:покажи|выбери|дай)\s+)?(?:(\d+)\s+)?(?:random\s+(?:tokens?|stocks?)|случайн(?:ые|ых|ый)\s+(?:токены|токенов|токена|токен|акции|акций))[.!?]?$/,
    );
  return match ? Number(match[1] ?? 8) : null;
}

export function randomMatches(symbols: string[], count: number): DiscoveryMatch[] {
  const pool = [...new Set(symbols)];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).map(symbol => ({ symbol, score: 0 }));
}
