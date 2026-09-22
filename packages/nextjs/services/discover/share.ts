import logos from "./logos.json";

export function discoveryPath(theme: string, symbols: string[], similar?: string) {
  if (!theme) return "/discover";
  const params = new URLSearchParams({ theme, card: "4" });
  if (symbols.length) params.set("stocks", symbols.join(","));
  if (similar) params.set("similar", similar);
  return `/discover?${params}`;
}

export function shareLayout(value: unknown, theme: string) {
  if (typeof value === "string" && /^[0-3]$/.test(value)) return Number(value);
  return [...theme].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 4;
}

export function shareSelection(theme: unknown, stocks: unknown) {
  return {
    theme:
      typeof theme === "string"
        ? theme
            .replace(/[\u0000-\u001f]/g, " ")
            .trim()
            .slice(0, 180)
        : "",
    symbols:
      typeof stocks === "string"
        ? [
            ...new Set(
              stocks
                .slice(0, 200)
                .split(",")
                .map(s => s.trim().toUpperCase()),
            ),
          ]
            .filter(s => Object.hasOwn(logos, s))
            .slice(0, 8)
        : [],
  };
}

export function shareOrigin(host: string | null, productionHost?: string) {
  const fallback = productionHost ? `https://${productionHost}` : "https://basqit.vercel.app";
  return host && ["basqit.ngrok.dev", "rhh.ngrok.dev", "basqit.vercel.app", productionHost].includes(host)
    ? `https://${host}`
    : fallback;
}
