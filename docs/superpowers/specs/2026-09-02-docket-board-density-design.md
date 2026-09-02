# Docket board density (desktop and phone)

**Date:** 2026-09-02
**Audience:** seated magistrates (speed, density, fewer mistakes)
**Status:** approved

## Problem

The Docket working sheet is buried under a full month of capacity tiles. On a phone, List view is still a 56rem spreadsheet with “Swipe sideways for the stage columns.” Tiles hide procedure entirely. Procedure saves toast “Logged on the board” with only “Log appearance,” so a mis-tap has no reverse. The matter chrome says **Delete** while the dialog says **Move to bin**. After scroll, the fixed 68px top nav covers **New matter**.

## Goal

A magistrate on a phone or a desktop can see the working sheet first, record a stage without panning eight columns, undo a bad stage tap, and move a file to the bin without thinking they are destroying it.

## Non-goals

- Light theme, skip links, tour focus trap, reduced-motion, type-size settings
- Changing capacity colour bands or `DocketStageCell` vocabulary
- Reworking Overview layout (except the Delete label)
- Fixing the walkthrough “Hearing progress” step (that target lives on Overview)
- New tour library, admin ingest, clerk/pending-magistrate coaching
- Changing default docket browse view (stays `list`)

## Breakpoint

**`lg` (1024px) and up:** spreadsheet (`DocketStageSheet`).
**Below `lg`:** stacked matter cards when browse view is List.

Tiles stay available on every width. Cards are the List layout on small screens, not a third browse mode.

## Shared behaviour (both widths)

### Capacity calendar

Replace the always-open month grid as the default.

1. Default chrome is a **week strip**: seven day tiles for the week that contains the selected date, or today when nothing is selected.
2. Week starts **Sunday**, matching the existing month grid in `docket-capacity-strip.tsx`.
3. Day tiles keep today’s `DayTile` behaviour: capacity fill, count, `aria-label`, tap to filter / tap again to clear.
4. Header row: `Week of {D MMM YYYY}` (Sunday’s date), **Today**, prev/next **week** chevrons, and **Month**.
5. **Month** is a button with `aria-expanded` and a labelled region (not `<details>`). Open shows the current month grid (existing `buildMonthGrid` + `DayTile`). Closing Month returns to the week strip; a date chosen in the month view becomes the selected filter and the week strip jumps to that week.
6. Prev/next while Month is closed moves by one week and clears the date filter (same as today’s month chevrons clearing selection).
7. Selected-date chips and “Showing all matters…” copy stay below the strip.
8. Extract week helpers (`weekStartSunday(isoDate)`, `daysOfWeek(weekStart)`) into `src/lib/docket-week.ts` and unit-test them in `scripts/tests/test-docket-week.mjs`. Do not parse `YYYY-MM-DD` with `new Date(string)` (UTC shift). Use local `Date(y, m-1, d)` like `DateOnlyInput`.

### Toolbar vs overlapping nav

Docket list actions (**Bin**, **Docket Capacity**, **New matter**) move into a `DocketToolbar` that is `sticky` at `top-[calc(68px+env(safe-area-inset-top))]` with `z-40` and the same `#141414` canvas as matter tabs. It stays tappable after the page title scrolls away.

`BrowseHeader` on Docket keeps title, description, and Tiles/List. It no longer holds those three actions.

Phone: toolbar buttons use `min-h-11`. **New matter** stays `variant="play"`. Bin and Capacity may be icon+label; do not drop the New matter label.

### Procedure undo

On a successful stage patch (list sheet, phone card, and Overview strip — one helper so they cannot drift):

- Toast title: `Logged on the board.`
- **Undo**: patch the same column back to the previous value with the latest `updated_at`. Failure uses the existing mutation error toast.
- **Log appearance**: unchanged.

Sonner `toast.success` takes `action` and `cancel`. Use `cancel: { label: "Undo", onClick: … }` and `action: { label: "Log appearance", onClick: … }`. If the toast API will only render one extra button, render **Undo** and drop **Log appearance** from that toast (the event dialog remains on Overview).

Do not add a confirm dialog before recording a stage.

### Move to bin copy

| Surface | Today | Change |
|---|---|---|
| Matter chrome button | Delete | Move to bin |
| Confirm dialog title | Move this matter to the bin? | keep |
| Bin page empty description | Matters you delete from the docket appear here for 7 days. | Matters you move to the bin appear here for 7 days. |
| Bin page header description | Deleted files stay here… | Binned files stay here for 7 days. Restore to put them back on the docket, or empty now to permanently delete. |

Keep the trash icon and destructive styling. The dialog still calls `useBinDocketMatter`.

### Walkthrough / copy

Docket header description today: “Swipe for stages on a phone.”

Change to: “List is the working sheet. On a phone each file shows its stages. Tiles stay for cover-photo browse. Set Next date and record hearing progress on each file.”

Remove the `sm:hidden` “Swipe sideways…” hint under the sheet. `data-tour="docket-board"` stays on the list container (sheet on desktop, card stack on phone). `data-tour="docket-new-matter"` stays on the toolbar New matter button.

## Phone List (`< lg`)

Each board row is a card, not a table.

```
GEO-2026-001                         [Next date cell]
Police v. Demo Defendant
[classification] [court if All My Courts] [appearance chip if date filter]
Current stage: Arraignment (match ring, already on the cell)

Arraignment     Custody
Disclosure      Trial
Ruling          Judgment
Sentence        Appeal
```

Rules:

- Case number + title is a link to the matter (`ROUTES.docketMatter`).
- Next date uses existing `NextDateCell` (same dialog).
- Eight cells are the existing `DocketStageCell` with `compact` **and** `min-h-11` on this layout (override the current `sm:min-h-7`).
- Grid is `grid-cols-2 gap-3`, same as Overview’s `DocketStageStrip`. Extract a `ProcedureStageGrid` used by Overview and the card so labels, current-stage ring, and attach-file behaviour stay one implementation. Overview keeps its Card wrapper and helper paragraph.
- Current stage is visible because `isCurrent` already rings the cell. Do not add a second “current stage” legend unless the ring is clipped; prefer the ring.
- `onPatch` / `onLogAppearance` are the same callbacks as `DocketStageSheet`.
- Cards stack vertically with `gap-3`. No max-height trap (today’s list table uses `max-h-[min(28rem,58dvh)]` on small screens — drop that for cards so the page scrolls normally).
- Empty / error / skeleton: keep `EmptyState` / `InlineError`; skeleton is stacked card placeholders, not a table block.

## Desktop List (`lg+`)

Keep `DocketStageSheet` as the spreadsheet (sticky case column, eight stages, next date). No swipe hint. Sticky toolbar still applies so **New matter** is not under the nav after scroll.

Do not change column vocabulary or attach-file on ruling/judgment.

## Data / state

No new tables or RPCs. Week helpers are pure date math. Toolbar is layout only. Undo is a second `onPatch` with the prior column value already on the row.

## Error handling

- Week/month navigation never throws; invalid ISO dates are ignored (no filter).
- Undo after a later edit on the same column: `expectedUpdatedAt` may 409. Show the existing conflict/error toast; do not retry in a loop.
- Sticky toolbar does not trap scroll; it only stays visible.

## Testing

- `scripts/tests/test-docket-week.mjs`: Sunday week start, week containing 2026-09-02, prev/next week, no UTC shift on `YYYY-MM-DD`.
- Update any walkthrough/copy test that asserts the swipe sentence.
- Manual: phone width cards (no horizontal pan to record a stage), desktop table unchanged, Month disclosure, Undo restores the cell, Move to bin label, New matter tappable after scrolling the list.
- Browser-verify Docket list at ~390px and ~1280px after implementation.

## Files

| File | Role |
|---|---|
| `src/lib/docket-week.ts` | Week start / days of week |
| `scripts/tests/test-docket-week.mjs` | Tests for the helpers |
| `src/pages/docket/docket-capacity-strip.tsx` | Week default, Month disclosure, week chevrons |
| `src/pages/docket/docket-toolbar.tsx` | Sticky Bin / Capacity / New matter |
| `src/pages/docket/docket-list-page.tsx` | Wire toolbar, cards vs sheet, copy |
| `src/pages/docket/docket-matter-card.tsx` | Phone list card |
| `src/pages/docket/procedure-stage-grid.tsx` | Shared 2×4 (and wrap) grid |
| `src/pages/docket/docket-stage-strip.tsx` | Use shared grid |
| `src/pages/docket/docket-stage-sheet.tsx` | Shared toast helper; remove swipe hint |
| `src/pages/docket/docket-stage-cell.tsx` | Optional `minHeight` for phone cards |
| `src/pages/docket/docket-matter-detail-page.tsx` | Move to bin label |
| `src/pages/docket/docket-bin-page.tsx` | Binned / move-to-bin copy |
| `package.json` | `test:docket-week` script next to existing docket tests |

## Success

- On a phone, the first screen after the title is a week of days, then matters; each matter’s eight stages are on-screen without sideways pan.
- On desktop, the spreadsheet remains the working sheet; the month is one click away.
- A mistaken stage tap can be undone from the toast.
- No user-facing control says Delete for a binned matter.
- New matter remains reachable after the list is scrolled.
