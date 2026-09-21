const labels: Record<string, string> = {
  TRADING_STATUS_TRADABLE: "Available",
  TRADING_STATUS_UNTRADABLE: "Unavailable",
  TRADING_STATUS_POSITION_CLOSING_ONLY: "Sell only",
  TRADING_STATUS_POSITION_OPENING_ONLY: "Buy only",
  tradable: "Available",
  untradable: "Unavailable",
  position_closing_only: "Sell only",
  position_opening_only: "Buy only",
};

export function tradingSessions(raw: unknown) {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const status = (value: unknown) => (typeof value === "string" ? (labels[value] ?? "Not reported") : "Not reported");
  return (
    [
      ["market", "Regular session"],
      ["extended", "Extended hours"],
      ["overnight", "Overnight"],
    ] as const
  ).map(([key, label]) => {
    const session = data[key];
    if (session && typeof session === "object") {
      const values = session as Record<string, unknown>;
      return { label, whole: status(values.whole), fractional: status(values.fractional) };
    }
    // The documented flat schema does not specify whole-share eligibility.
    const fractional =
      key === "market"
        ? status(data.fractionalTradability)
        : key === "extended" && typeof data.extendedHoursFractionalTradability === "boolean"
          ? data.extendedHoursFractionalTradability
            ? "Available"
            : "Unavailable"
          : "Not reported";
    return {
      label,
      whole: "Not reported",
      fractional,
      ...(key === "overnight" ? { overall: status(data.allDayTradability) } : {}),
    };
  });
}
