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

The visual language is Netflix's: a near-black canvas, content lifted off it by luminance and shadow rather than frames, one red commit action, tight-tracked display titles. The light palette is the same system on warm paper.

- **Raise, don't frame.** A region that must stand off the canvas is `bg-card` (or `bg-surface-1`) with `shadow-elevation-1` and a `border-hairline` crease. Never `border-border` on a card or panel: that is the divider token. High contrast has no shadows, so add `hc:border-border` alongside the hairline — `Card` does this for you; use `Card` before reaching for a bespoke `div`.
- **Surface scale**: `surface-1` raised, `surface-2` nested or hover, `surface-3` pressed / top of a stack. Selected segments are `bg-surface-1 shadow-elevation-1` inside a `bg-surface-2` track.
- **Elevation**: `shadow-elevation-1` resting card, `-2` sticky bars and hover lift, `-3` menus and the hovered poster. Not `shadow-lg`, not a literal `rgba` shadow.
- **Type scale**: `text-display-xl` (Billboard) · `text-display` (page title) · `text-title-lg` (empty-state / hero heading) · `text-title` (row and section headings) · `text-heading` (card titles). Each sets weight, tracking and leading; do not add `font-bold tracking-tight` on top. Small uppercase labels are the `eyebrow` utility (deliberately not `text-`-prefixed: tailwind-merge would treat it as a colour).
- **Reading measure**: long legal text read in place (a judgment's body, case law's summary and full text) is `text-base leading-relaxed` in a `max-w-measure` column, about 70 characters per line, sitting unframed on its card. An editor keeps its frame and full width.
- **Page headers** are `BrowseHeader` with the workspace `tone`; it draws the edge-to-edge band. Empty states on a browse page pass the same `tone` to `EmptyState`.
- **Motion**: hover lifts and page changes use `ease-out-expo`; sticky chrome frosts (`bg-background/85 backdrop-blur-md hc:bg-background`) rather than going opaque with a hard shadow.

## Buttons

One of each per surface:

- `default` (red) — the commit action: create, save, finalise, connect.
- `play` (white) — a Billboard's lead action only. Never on a list page or in a card.
- `more` — translucent on cinematic art; the Billboard's second action and a detail page's Back.
- `secondary` — quiet filled tools and refinement clears on plain canvas; `outline` is the same weight with an edge for use on a card.
- `ghost` / `link` — icon buttons, inline controls, inline links.

A view switch (Tiles / List, Month / Agenda, Weekly / Daily / Monthly) is a segmented control (`Tabs variant="segmented"` or a `role="group"` of ghost buttons on a `bg-surface-2` track), never a red button.

## Colour and tokens

- Text colour comes from tokens: `text-foreground`, `text-muted-foreground`, `text-link`. Do not derive secondary text with opacity (`text-foreground/50`) — it bypasses the high-contrast palette and fails 4.5:1 in light mode below `/65`.
- Control borders are `border-input` (≥3:1 in every palette); dividers and cards are `border-border`. Not `border-foreground/10`.
- Status colours are registered tokens: `bg-notice-action`, `text-stage-progress`, `bg-capacity-full`, plus `warning` / `success` / `info` aliases. Never `bg-[hsl(var(--…))]`, never `amber-500`.
- Radius scale: `rounded-sm` 2px, `rounded-md` 4px (default — use this, not bare `rounded`), `rounded-lg` 6px. Cards, posters and chips are `rounded-md`.
- Tabs default to the underline rail (`data-[state=active]:border-primary`); the active nav link carries the same red rule, so "where am I" is one mark across the product.
- Sizes: inputs and buttons are 44px / 16px on phones and 36px / 14px from `lg` up; the primitives do this, do not override heights.

## Z-index tiers

`z-nav` 50 (top bar) < `z-dialog` 60 (dialog, sheet) < `z-popover` 70 (menus, select) < `z-hint` 80 (tooltip, details hint) < `z-skip` 100 (skip link) < `z-tour` 200 (walkthrough) < `z-lock` 220 (session lock). No `z-[NN]`.

## Motion and focus

- Never `outline-none` without a `focus-visible:ring-*` replacement; the global `:focus-visible` rule is the floor.
- Every animation and transition is collapsed under `prefers-reduced-motion`; do not add `motion-safe:` variants by hand.
