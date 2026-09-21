export type DiscoveryMatch = { symbol: string; score: number };

export function normalizeTheme(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const theme = value.trim().replace(/\s+/g, " ");
  return theme.length >= 3 && theme.length <= 180 ? theme : null;
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
