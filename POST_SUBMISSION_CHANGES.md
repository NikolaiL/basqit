# Post-submission changes

## FounderHouse Singapore Post Submissions

### 2026-10-25 — Packs ready-to-reveal state

When the opening's target signature or cached randomness is available, the heading changes to
“Your pack is ready to be revealed.” The round counters and countdown are hidden, and the existing
Reveal results button stays in place and becomes available when the wallet is ready.

The heading reserves the space its ready text needs at the current viewport width. The status area
keeps its existing reserved height, so hiding the counters does not shift the pack or actions.
Readiness still requires a target signature or cached randomness; elapsed time alone cannot enable reveal.
This is a frontend presentation change, with no contract or on-chain changes.

Validation: waiting-to-ready browser checks at 1280×720, 320×640, 390×844 and 430×932 confirmed
unchanged panel, heading, status, pack and action geometry. The checks used simulated proof availability
with live round data and no wallet transaction. Production build, type checks, focused lint and all
14 Packs service test entries passed.

## OpenHouse Post Submissions

Two front-end commits made after the OpenHouse deadline. No contract or on-chain changes.

### `c9d085b` — page performance optimisation (2026-10-05)

Faster page load: mono font no longer preloaded, analytics loaded lazily, stock logos use Next.js
image optimisation. Also tried darker discovery button colours.

- `packages/nextjs/app/layout.tsx`
- `packages/nextjs/components/AnalyticsScripts.tsx`
- `packages/nextjs/components/StockLogo.tsx`
- `packages/nextjs/components/discover/StockDiscovery.tsx`
- `packages/nextjs/next-env.d.ts`

### `92d08d4` — button color improvement (2026-10-05)

Restored the original discovery button colours, because did not like them after a longer look.

- `packages/nextjs/components/discover/StockDiscovery.tsx`
- `packages/nextjs/next-env.d.ts`
