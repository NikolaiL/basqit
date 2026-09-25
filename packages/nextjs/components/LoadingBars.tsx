/** The logo's three bars, bouncing: Basqit's loading indicator. `small` fits inline next to text. */
export function LoadingBars({ small }: { small?: boolean }) {
  return (
    <span className={small ? "bq-bars bq-bars-small" : "bq-bars"} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
