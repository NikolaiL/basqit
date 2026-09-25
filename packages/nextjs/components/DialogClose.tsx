import { XMarkIcon } from "@heroicons/react/24/outline";

/** The tilted sticker close button; pinned to a dialog's top-right corner by `.modal-box > .bq-close`. */
export function DialogClose({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="bq-close" aria-label={label} disabled={disabled} onClick={onClick}>
      <XMarkIcon aria-hidden="true" />
    </button>
  );
}
