# Post-submission changes

Two front-end commits made after the hackathon deadline. No contract or on-chain changes.

## `c9d085b` — page performance optimisation (2026-10-05)

Faster page load: mono font no longer preloaded, analytics loaded lazily, stock logos use Next.js
image optimisation. Also tried darker discovery button colours.

- `packages/nextjs/app/layout.tsx`
- `packages/nextjs/components/AnalyticsScripts.tsx`
- `packages/nextjs/components/StockLogo.tsx`
- `packages/nextjs/components/discover/StockDiscovery.tsx`
- `packages/nextjs/next-env.d.ts`

## `92d08d4` — button color improvement (2026-10-05)

Restored the original discovery button colours, because did not like them after a longer look.

- `packages/nextjs/components/discover/StockDiscovery.tsx`
- `packages/nextjs/next-env.d.ts`
