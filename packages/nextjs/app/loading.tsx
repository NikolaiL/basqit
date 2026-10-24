import { LoadingBars } from "~~/components/LoadingBars";

export default function Loading() {
  return (
    <div
      className="flex flex-1 min-h-64 items-center justify-center gap-3 py-16"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <LoadingBars />
      <span>Loading page…</span>
    </div>
  );
}
