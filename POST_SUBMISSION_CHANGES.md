# Post-submission changes

## FounderHouse Singapore Post Submissions

### 2026-10-25 — Compact quantity presets under the stepper

The 1/5/10 shortcuts now sit directly below the minus/input/plus control as small underlined actions.
They use 24px-high targets, 16px horizontal spacing, no filled background or raised edge, and purple
text for the current preset. The main stepper retains its 44px controls and editable numeric field.
This replaces the earlier separate preset button row while preserving keyboard focus, pressed states,
purchase locking and total updates.

Validation: browser assertions at 1280, 320, 390 and 430px confirmed the links sit below the stepper,
use underlined text without background/shadow, and cause no horizontal overflow. Clicks, keyboard
activation, stepper interaction and total updates passed. Frontend build passed.

### 2026-10-25 — Rounded pack quantity selector hover states

The 1/5/10 presets now use separate buttons with 8px spacing and consistent 12px corners. Removing
the joined-segment styling prevents square middle buttons and shared edges on hover. Unselected
buttons use a flat lilac hover, while the selected option keeps its raised sticker treatment.
Existing keyboard focus, pressed states, 44px tap targets and quantity behavior are preserved.

Validation: actual hover and keyboard-selected states showed a flat lilac hover beside a raised
selected button. Browser assertions at 1280, 320, 390 and 430px confirmed all four corners remain 12px,
spacing remains 8px, targets remain at least 44px and the page has no horizontal overflow. Frontend
build passed.

### 2026-10-25 — Tappable pack quantity controls

Quantity now has minus and plus buttons beside its editable field. Controls use Basqit's secondary
sticker buttons, typography and focus styling, with 44×44px tap targets and 8px spacing. Quick quantity
presets also have 44px target height. Buttons stop at the existing 1–100 limits and lock during a
purchase. Native number stepping preserves typed input and arrow-key support; the field uses a numeric
mobile keyboard and 16px text. Buttons have descriptive accessible names, and an output announces
quantity changes. Redundant step buttons stay outside the Tab sequence while remaining touch/voice
accessible, following the [W3C quantity pattern](https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/examples/quantity-spinbutton/)
and [target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html).

Validation: real-page browser checks covered increment/decrement, 1/100 bounds, empty-field recovery,
manual typing, native arrow keys, presets, total updates and announcement text. All quantity buttons
met 44px targets at 1280, 320, 390 and 430px widths with no horizontal overflow. Frontend build and all
14 Packs service test entries passed. Wallet signing and physical assistive devices were not retested.

### 2026-10-25 — Reveal action in the countdown area and automatic first card

The ready opening replaces its countdown area with the Reveal results action. Waiting openings no
longer reserve an action below the pack. The header, status area and pack keep their positions.
After confirmed on-chain results arrive, the first card opens automatically without a second click.
Additional cards still use Next card or Show all; sample previews retain their manual opening.
Reduced-motion preferences show the result immediately. Payout refreshes do not restart the animation.
Proof errors, wallet rejection and transaction failures keep their existing handling. Reveal still
requires a user-confirmed transaction, and payouts are collected separately.

Validation: browser assertions at 1280, 320, 390 and 430px confirmed stable waiting-to-ready geometry,
the action inside the status area and no lower placeholder. Simulated confirmed results opened the
first single/multiple card automatically; Next card, Show all, payout refresh and manual sample preview
checks passed without a wallet transaction. Frontend build, type checks and all 14 Packs service test
entries passed.

### 2026-10-25 — Hide reveal action while waiting

The opening dialog hides the Reveal results button until the target signature or cached randomness is
available. Its layout space stays reserved, so the button appears without moving the pack or footer.
Countdown completion alone still cannot enable reveal; the existing proof and wallet checks apply.
Connection and signature errors remain visible while waiting.

Validation: simulated proof arrival with the real opening dialog and waiting component at 1280, 320,
390 and 430px widths preserved panel, heading, status, pack, action and footer geometry. The waiting
action was hidden and disabled, then visible and enabled after proof availability. Frontend build passed.

### 2026-10-25 — Revealed pack amounts and USD references

Revealed cards and the Show all collection display stock quantities with up to six decimal places,
without trailing zeros. Positive quantities below that precision display as `<0.000001` instead of zero.
Both views also show a USD reference based on the actual payout stock and the existing live price feed.
The calculation uses the full on-chain quantity, with an unavailable message when a quote is missing.
Stock labels in collection rows use the same six-decimal formatting. Transaction amounts are unchanged.

Validation: frontend build and 15 Packs/formatting checks pass; individual and Show all cards were
checked at mobile and desktop widths without horizontal overflow.

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
