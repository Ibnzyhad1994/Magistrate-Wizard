# UI conventions

Short rules for anything user-facing. Primitives live in `src/components/ui`; if a rule here and a primitive disagree, fix the primitive.

## Loading, empty, error

- **Skeleton** for a region whose shape is known (list, card grid, detail header). The wrapper carries `aria-busy="true"` or `role="status"` with `sr-only` text ("Loading docket…"); `<Skeleton>` itself is `aria-hidden`.
- **Spinner** (`Loader2` + `sr-only` text) only for an action in flight (a button, a save indicator), never for a page.
- **`PageLoader`** for a full-route first load only.
- **`EmptyState`** for "nothing here yet" — never a bare `<p>No … yet</p>`. Give it the one action that creates the first item.
- **`Alert`** (`ui/alert.tsx`) for inline, persistent notices; **toast** for transient outcomes of an action. Never both for the same event.

## Toasts

- Errors: `Couldn't <verb> <thing>.` — "Couldn't" (not "Could not" / "Failed to"), full stop, British spelling. Success: `<Thing> saved.` / `<Thing> deleted.` with a full stop. Sentence case; product nouns (Docket Matter, Bench Note) keep their capitals.
- The global mutation/query cache subscriber in `src/lib/query-client.ts` toasts every unhandled error. A hook that toasts in its own `onError` **must** set `meta: { silent: true }` or the user sees it twice. Silence only affects what the user sees — every failure is still sent through `reportError`.
- Never show `error.message` raw. Route it through `getErrorMessage`; add a mapping in `UNIQUE_VIOLATION_MESSAGES` when a constraint becomes user-visible. Unmapped database text is replaced by a generic sentence and reported to Sentry.
- Toast kind is carried by the left edge (error red, success green, warning amber, info blue) — set it with `toast.error` / `toast.success` etc., not by wording alone.

## Forms and saving

- New forms use `useAppForm` (`src/hooks/use-app-form.ts`): validation on first blur, then per keystroke.
- Dialog and sheet forms pass `preventDismissWhenDirty={form.formState.isDirty}` so click-outside / Escape cannot discard input; the explicit Cancel and Close controls still work.
- Save models, pick one per surface and say which in the header:
  - **Explicit save** (dialogs, short forms): Save/Cancel buttons; nothing persists until Save.
  - **Autosave + indicator** (long editors: bench notes, judgments, legal library): `SaveIndicator` shows Saving/Saved/Unsaved; `useUnsavedChangesGuard` blocks navigation while dirty.
- Destructive actions confirm through `AlertDialog`, or offer an undo toast; never neither.

## Surfaces, elevation and type

The visual language is Netflix's: a near-black canvas, content lifted off it by luminance and shadow rather than frames, one Sealing Wax (warm red) commit action, tight-tracked display titles. The light palette is the same system on warm paper.

- **Raise, don't frame.** A region that must stand off the canvas is `bg-card` (or `bg-surface-1`) with `shadow-elevation-1` and a `border-hairline` crease. Never `border-border` on a card or panel: that is the divider token. High contrast has no shadows, so add `hc:border-border` alongside the hairline — `Card` does this for you; use `Card` before reaching for a bespoke `div`.
- **Surface scale**: `surface-1` raised, `surface-2` nested or hover, `surface-3` pressed / top of a stack. A selected segment sits one surface step above its `bg-surface-2` track: `SEGMENT_ON_CLASS` in `components/ui/segmented.ts` (surface-1 in light, surface-3 in dark and colourblind dark through the `dim:` variant, inverted to foreground in high contrast, hover included).
- **Dark ladder** (dark and colourblind dark): a cool near-black canvas (`224 14% 6%`, `#0D0E11`), then card and `surface-1` at 9%, `surface-2` at 12.5% and `surface-3` at 17% lightness, all on the same cool hue. The hairline and the divider `border` are 19%: at least 1.3:1 against the canvas, the card and `surface-1`, so a raised region separates by its crease, not by a heavy shadow. Muted text is at least 4.5:1 and the focus ring at least 3:1 on every step, in all six palettes; `npm run test:theme` enforces the ladder. Browser chrome and native status-bar colours (`THEME_COLOR` in `src/lib/theme.ts`, `index.html`, `native-shell.ts`, `capacitor.config.ts`, `electron/main.mjs`) mirror the canvas and change with it. Never give a surface a literal neutral background (`bg-[#141414]`, `bg-zinc-900`): it falls off the ladder.
- **Elevation**: `shadow-elevation-1` resting card, `-2` sticky bars and hover lift, `-3` menus. In dark each is small, with a 1px inner top highlight (`inset 0 1px 0` white at 3.5-5%). Not `shadow-lg`, not a literal `rgba` shadow.
- **Tables** sit on the ladder: the header row on `surface-1`, a hovered row on `surface-2`, a selected row on `surface-3`, and rows divided by the `border` divider token, all from `Table`. A sheet with sticky columns (the docket List sheet) uses `border-separate border-spacing-0`, where row borders do not paint, so its cells carry the dividers (`[&>tr>td]:border-b`, the last row without one), the sticky case column ends in a 1px `border-r` divider rather than a drawn shadow, and its opaque cells follow the row's hover (`group/row`, `group-hover/row:bg-surface-2`). The sheet's frame, and each matter card that replaces it below `lg`, is a raised region: `border-hairline`, `shadow-elevation-1`, `hc:border-border`, `rounded-md`. Figures in the sheet body are `tabular-nums`.
- **Tone washes** behind a page header are drawn at `--tone-alpha`: 0.34 on the dark ladder, so the hue tints the header without flooding it.
- **Type scale**: `text-display-xl` (Billboard) · `text-display` (page title) · `text-title-lg` (empty-state / hero heading) · `text-title` (row and section headings) · `text-heading` (card titles). Each sets weight, tracking and leading; do not add `font-bold tracking-tight` on top. Small uppercase labels are the `eyebrow` utility (deliberately not `text-`-prefixed: tailwind-merge would treat it as a colour).
- **Identifiers** (case numbers, citations, statute codes, quick-code words) are not labels: they carry the `identifier` utility (normal tracking, the text's own case, tabular figures), never `uppercase` or wide `tracking-[…]`, so a case number never wraps mid-number and digits line up down a column. `TitleCard` and `Billboard` take one through their `identifier` prop, never `eyebrow`. Inter's tabular figures also set the hyphen to figure width. `npm run test:identifiers` guards this.
- **Reading measure**: long legal text read in place (a judgment's body, case law's summary and full text) is `text-base leading-relaxed` in a `max-w-measure` column, about 70 characters per line, sitting unframed on its card. An editor keeps its frame and full width.
- **Page headers** are `BrowseHeader` with the workspace `tone`; it draws the edge-to-edge band. Empty states on a browse page pass the same `tone` to `EmptyState`.
- **Detail headers** (a docket matter, judgment, case-law authority, statute, bench note or callover) are `Billboard variant="detail"`, which draws the same tone band as `BrowseHeader`: no art, no set-dressing icon, the title in `text-display`, stepping down to 22px below `sm` so a long case title stays at three or four lines on a phone. Its actions (Back first) are quiet `ghost` tools at the page's tool size (`size="sm"`), kept at 44px below `lg`. The eyebrow (case number, citation) is full `text-foreground`, because it sits where the band is strongest. The nav keeps its resting fade over it; only Home's hero billboard turns the nav cinematic.
- **Identification photos** are a party's photo, never art. On a detail header a cover shows only as a small documentary inset (floated top right, `rounded-md` with a hairline), never as the backdrop.
- **Motion**: hover lifts and page changes use `ease-out-expo`; sticky chrome frosts (`bg-background/85 backdrop-blur-md hc:bg-background`) rather than going opaque with a hard shadow. A tile in a dense grid, such as a capacity day, never moves on hover: its hover is a shadow step with no translate, so the strip does not twitch under the pointer.

## Stills (browse tiles)

Every browse page (docket Tiles, judgments, case law, legislation, bench notes, bookmarks, search) and the Home rails show `TitleCard` as a 16:9 still.

- **Words below the art, never on it.** The art is the tone gradient and icon with the status flag and type label in one row across its top; the case number, title, subtitle and meta sit below on `bg-card`, so their contrast is the card's, not a photo's.
- **Identification photos are never the still.** A matter's cover is shown only as a small documentary inset on the tone art, never full-bleed and never hero art.
- **Columns, not widths.** The container sets the size: `TitleGallery` is a grid and `ContentRow` a rail, both fed by `TILE_COLUMNS` in `src/lib/browse-prefs.ts` through `stillColumnVars`, and the `.still-grid` / `.still-rail` rules in `index.css`. `TitleCard` fills whatever it is given; do not give a still its own width. Put new tiles in one of the two containers.
- **The column table** (Compact / Regular / Large): under 640px 2 / 2 / 1, 640-767 3 / 2 / 1, 768-1023 4 / 3 / 2, 1024-1535 5 / 4 / 3, 1536 and up 6 / 5 / 4, 12px gaps. Compact stays the default. At no width may a size show fewer columns than the next larger size, and no still may be narrower than 136px, the width a 16-character case number needs on one line; `npm run test:still-scale` checks both from 360 to 1920px. A rail still is 90% of a gallery column so the next one peeks.
- **Text**: case number never truncated (it may wrap at a hyphen, never an ellipsis); title `text-sm font-semibold`, at most four lines; subtitle at most two; court and date wrap to a second line rather than an ellipsis. Stills in one row share a height.
- **Hover** is a surface step (`bg-surface-2`, 120ms), never a scale, and only for a fine pointer: use the `hover-fine:` variant so a tap on a touch screen never leaves a hover state behind. Focus is the wrapper's ring; a rail keeps `py-1` so its overflow does not clip it.

## Buttons

One of each per surface:

- `default` (red) — the commit action: create, save, finalise, connect.
- `play` (white) — a Billboard's lead action only. Never on a list page or in a card.
- `more` — translucent on cinematic art; the Home billboard's second action only.
- `secondary` — quiet filled tools and refinement clears on plain canvas; `outline` is the same weight with an edge for use on a card.
- `ghost` / `link` — icon buttons, inline controls, inline links, and a detail header's Back and other header actions.

A view switch (Tiles / List, Month / Agenda, Weekly / Daily / Monthly) is a segmented control (`Tabs variant="segmented"`, or a `role="group"` of ghost buttons with `aria-pressed` on a `SEGMENT_TRACK_CLASS` track, the selected one `SEGMENT_ON_CLASS`), never a red button.

## Colour and tokens

- Text colour comes from tokens: `text-foreground`, `text-muted-foreground`, `text-link`, `text-destructive-text`. Do not derive secondary text with opacity (`text-foreground/50`) — it bypasses the high-contrast palette and fails 4.5:1 in light mode below `/65`.
- **Accent and destructive are two reds.** The accent (`primary`) is Sealing Wax (`#BF3C22` in dark, `#A7321B` light, `#CC2200` high-contrast dark, `#8F1800` high-contrast light) and marks the commit button, the active rule, the wordmark and the seal. It is never Netflix's `#E50914`: `npm run test:theme` keeps every palette more than ΔE<sub>OK</sub> 0.05 from it. `destructive` is its own red (orange in the colourblind palettes) for fills: a destructive button, an invalid field's border. Red words and icons are `text-destructive-text`, never `text-destructive`: it clears 4.5:1 on the canvas, a card, a menu and a ghost button's hover in every palette, where the fill red is under 4.5:1 in dark.
- The seal (`public/favicon.svg`) and its glows follow the accent: a glow is `hsl(var(--primary)/…)`, never a literal `rgba`. When the seal's artwork changes, bump the `?v=` on every reference (`index.html`, `app-logo.tsx`, `auth-splash.tsx`).
- Control borders are `border-input` (≥3:1 in every palette); dividers and cards are `border-border`. Not `border-foreground/10`.
- Status colours are registered tokens: `bg-notice-action`, `text-stage-progress`, `bg-capacity-full`, plus `warning` / `success` / `info` aliases. Never `bg-[hsl(var(--…))]`, never `amber-500`.
- Text on a capacity fill uses the fill's paired ink, `text-capacity-full-foreground` and its siblings, never `text-white` or `text-neutral-900`: each pair is at least 4.5:1 in every palette, and `npm run test:theme` enforces it.
- Status badges take their variant from `statusBadgeVariant` (`src/components/common/status-badge-variant.ts`): `success` (green) for a live or in-force record, `secondary` / `outline` for not yet or no longer live, `destructive` for refused, dismissed or in error. A status is never the `default` (red) badge; red belongs to the commit action.
- A browse tile's status flag (`TitleCard` `status`, on the art and on list rows alike) is a `bg-card` chip with an inset `ring-border` edge, a 2px `rounded-sm` tag, and a dot from `statusDotClass`, the same map as a fill: green live, red refused, neutral otherwise. The chip never takes the accent or a status fill, so its word stays at 15:1 over any art in every palette, and each dot clears 3:1 against it; `npm run test:theme` enforces both. A flag that is not a status (`Canonical`, an appearance type, an instrument type) passes `badge` alone and has no dot.
- Radius scale: `rounded-sm` 2px, `rounded-md` 4px (default — use this, not bare `rounded`), `rounded-lg` 6px. Cards and chips are `rounded-md`; a still is `rounded-lg`.
- Tabs default to the underline rail (`data-[state=active]:border-primary`); the active nav link carries the same red rule, so "where am I" is one mark across the product.
- Sizes: inputs and buttons are 44px / 16px below `lg` (phones and tablets) and 36px / 14px from `lg` up (`Button size="sm"` is 44px below `lg`, 32px from it); the primitives do this, do not override heights. See "Phones and tablets".

## Phones and tablets

Below `lg` (1024px) the app is used by touch; from `lg` up every size stays the compact desktop one.

- **Touch targets**: every tappable control is at least 44px tall below `lg`. Write it mobile-first as `min-h-11 … lg:min-h-<desktop>` (or `lg:min-h-0`), never `max-lg:`, so the desktop box stays exactly what it was. `min-h`, not `h`, so a wrapped label never clips and a caller's `h-8` still yields 44px on a phone.
- **Keep the visual small, grow the target**: a pill, chip or badge that is a control keeps its size and sits inside a 44px button (`inline-flex min-h-11 items-center`); the pill carries the focus ring through `group-focus-visible:`. An icon inside a field (the date input's calendar) gets a full-height, 44px-wide button and the field's end padding makes room for it.
- **The one exception** is a link or button inside a sentence, such as "5 matters in all" in the capacity caption (WCAG 2.5.8 inline exception). A native checkbox counts together with its `label`, so the label row is `min-h-11` below `lg`.
- **Guarded in CI**: `e2e/touch-targets.spec.ts` signs in at 390 × 844 and fails on any visible, enabled control under 44px on Home, the docket list and a matter, judgments and case law. It runs in the authenticated Playwright job in CI only.
- **Stacked details**: a details grid of fields is one column below `sm` (`grid-cols-1 sm:grid-cols-2`), so a value such as a court name is never cut inside its input on a phone.
- **Reading on a phone**: the card that holds long legal text (a judgment's Content, case law's read-only Details) has 16px sides below `sm` (`px-4 sm:px-6` on its header and content), about 42 characters a line at 390px. The 65-75 character measure is the desktop rule and `max-w-measure` still sets it.
- **Safe areas**: anything fixed or sticky against a screen edge pads that edge with `env(safe-area-inset-*, 0px)` added to its normal padding: the top bar, sticky toolbars, the docket's sticky selection bar (bottom), and sheets on every edge they touch (the `Sheet` primitive does this per side, and moves its close button below the notch). A sheet that overrides the padding (`p-0`, `p-3`) must add the insets back itself, as `MobileNav` does.

## Z-index tiers

`z-nav` 50 (top bar) < `z-dialog` 60 (dialog, sheet) < `z-popover` 70 (menus, select) < `z-hint` 80 (tooltip, details hint) < `z-skip` 100 (skip link) < `z-tour` 200 (walkthrough) < `z-lock` 220 (session lock). No `z-[NN]`.

## Motion and focus

- Never `outline-none` without a `focus-visible:ring-*` replacement; the global `:focus-visible` rule is the floor.
- Focus colour is the `--ring` token (`ring-ring`): blue in every palette except high-contrast dark, which is yellow. It never equals `--destructive` or `--primary`, so a focused field cannot read as an error, and it clears 3:1 against both the canvas and the card.
- Primitives draw focus as `focus-visible:ring-2 focus-visible:ring-ring` with no offset: one width, no gap, the same on every surface.
- Every animation and transition is collapsed under `prefers-reduced-motion`; do not add `motion-safe:` variants by hand.
- Motion is quiet and short: a work tool, not a trailer. Sheets and dialogs (and their scrims) open in 240ms and close in 180ms on `ease-out-expo` (`duration-240` / `duration-180`), animating only `transform` and `opacity`; `Sheet` and `DialogContent` already do this, so do not set a duration on them. A hover is a surface step in 120ms (`duration-120`), never a scale, behind `hover-fine:`. Nothing waits on an animation before it accepts input.
