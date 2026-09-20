import type { CorporateAction } from "./types";

export type MultiplierTransition = {
  address: string;
  before: string;
  after: string;
  effectiveAt: string;
  transactionHash: string;
  blockNumber: string;
  logIndex: number;
};

// A date-window correlation is evidence, not an issuer-provided event ID join.
export function matchMultiplier(
  action: CorporateAction,
  peers: CorporateAction[],
  transitions: MultiplierTransition[],
): MultiplierTransition | undefined {
  const candidates = (event: CorporateAction) => {
    if (!event.date) return [];
    const start = Date.parse(`${event.date}T00:00:00Z`);
    return transitions.filter(log => {
      const time = Date.parse(log.effectiveAt);
      return time >= start && time < start + 3 * 86400000;
    });
  };
  if (action.status !== "CORPORATE_ACTION_STATUS_COMPLETED") return;
  const matches = candidates(action);
  if (matches.length !== 1) return;
  const match = matches[0];
  if (peers.some(peer => peer.id !== action.id && candidates(peer).includes(match))) return;
  return match;
}
