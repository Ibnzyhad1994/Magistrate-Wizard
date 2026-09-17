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

## Colour and tokens

- Text colour comes from tokens: `text-foreground`, `text-muted-foreground`, `text-link`. Do not derive secondary text with opacity (`text-foreground/50`) — it bypasses the high-contrast palette and fails 4.5:1 in light mode below `/65`.
- Control borders are `border-input` (≥3:1 in every palette); dividers and cards are `border-border`. Not `border-foreground/10`.
- Status colours are registered tokens: `bg-notice-action`, `text-stage-progress`, `bg-capacity-full`, plus `warning` / `success` / `info` aliases. Never `bg-[hsl(var(--…))]`, never `amber-500`.
- Radius scale: `rounded-sm` 2px, `rounded-md` 4px (default — use this, not bare `rounded`), `rounded-lg` 6px.
- Sizes: inputs and buttons are 44px / 16px on phones and 36px / 14px from `lg` up; the primitives do this, do not override heights.

## Z-index tiers

`z-nav` 50 (top bar) < `z-dialog` 60 (dialog, sheet) < `z-popover` 70 (menus, select) < `z-hint` 80 (tooltip, details hint) < `z-skip` 100 (skip link) < `z-tour` 200 (walkthrough) < `z-lock` 220 (session lock). No `z-[NN]`.

## Motion and focus

- Never `outline-none` without a `focus-visible:ring-*` replacement; the global `:focus-visible` rule is the floor.
- Every animation and transition is collapsed under `prefers-reduced-motion`; do not add `motion-safe:` variants by hand.
