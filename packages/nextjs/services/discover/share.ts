import logos from "./logos.json";

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
