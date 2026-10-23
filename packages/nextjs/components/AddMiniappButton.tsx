"use client";

import { useState } from "react";
import { useMiniapp } from "~~/components/MiniappProvider";

export function AddMiniappButton() {
  const { isMiniApp, context, promptAddMiniApp, addError } = useMiniapp();
  const [pending, setPending] = useState(false);
  if (!isMiniApp) return null;
  return (
    <div>
      <button
        className="btn btn-sm"
        aria-label={context?.client.added ? "Basqit added to Farcaster" : "Add Basqit to Farcaster"}
        disabled={pending || context?.client.added}
        onClick={async () => {
          setPending(true);
          try {
            await promptAddMiniApp();
          } finally {
            setPending(false);
          }
        }}
      >
        {context?.client.added ? "Added" : pending ? "Adding…" : "Add app"}
      </button>
      {addError && <p role="alert">{addError}</p>}
    </div>
  );
}
