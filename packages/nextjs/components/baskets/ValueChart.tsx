"use client";

/** Value per share over time as a hand-drawn SVG line; rebalances are marked on it. */
export function ValueChart({ points, rebalances }: { points: { at: number; value: number }[]; rebalances: number[] }) {
  if (points.length < 2) return <p className="bq-chart-empty">No history yet.</p>;
  const [t0, t1] = [points[0].at, points[points.length - 1].at];
  const values = points.map(p => p.value);
  const [lo, hi] = [Math.min(...values), Math.max(...values)];
  const pad = (hi - lo || hi || 1) * 0.08;
  const x = (at: number) => ((at - t0) / Math.max(t1 - t0, 1)) * 600;
  const y = (v: number) => 220 - ((v - lo + pad) / (hi - lo + 2 * pad)) * 220;
  const valueAt = (at: number) => points.reduce((best, p) => (p.at <= at ? p : best), points[0]).value;
  const change = ((values[values.length - 1] - values[0]) / values[0]) * 100;
  return (
    <figure className="bq-chart">
      <svg
        viewBox="0 0 600 220"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Value per share from $${values[0].toFixed(2)} to $${values[values.length - 1].toFixed(2)}`}
      >
        <polyline points={points.map(p => `${x(p.at)},${y(p.value)}`).join(" ")} />
        {rebalances
          .filter(at => at >= t0 && at <= t1)
          .map(at => (
            <circle key={at} cx={x(at)} cy={y(valueAt(at))} r="4" />
          ))}
      </svg>
      <figcaption className={change >= 0 ? "is-up" : "is-down"}>
        {`${change >= 0 ? "+" : ""}${change.toFixed(1)}% in this range`}
      </figcaption>
    </figure>
  );
}
