/** Chunky rounded arrow for links; `out` tilts it for links that leave Basqit. */
export function Arrow({ out }: { out?: boolean }) {
  return (
    <svg
      className={out ? "bq-arrow bq-arrow-out" : "bq-arrow"}
      viewBox="0 0 16 16"
      width="0.9em"
      height="0.9em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 8h10.5M8.5 3.5 13 8l-4.5 4.5" />
    </svg>
  );
}
