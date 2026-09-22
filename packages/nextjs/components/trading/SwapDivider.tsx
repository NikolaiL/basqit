"use client";

export function SwapDivider({
  loading,
  directionLabel,
  disabled = false,
  onReverse,
}: {
  loading: boolean;
  directionLabel: string;
  disabled?: boolean;
  onReverse?: () => void;
}) {
  const arrow = (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 4v16m-7-7 7 7 7-7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
  return (
    <div className="bq-swap-divider">
      {onReverse ? (
        <button
          type="button"
          className="btn btn-circle bq-swap-direction"
          aria-busy={loading}
          aria-label={directionLabel}
          disabled={disabled}
          onClick={onReverse}
        >
          {arrow}
        </button>
      ) : (
        <div
          className="btn btn-circle bq-swap-direction bq-swap-direction-static"
          role="img"
          aria-label={directionLabel}
          aria-busy={loading}
        >
          {arrow}
        </div>
      )}
    </div>
  );
}
