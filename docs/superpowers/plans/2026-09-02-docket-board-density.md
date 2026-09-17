# Docket Board Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Magistrates see the Docket working sheet first, record stages on a phone without sideways pan, undo a bad stage tap, and move a file to the bin without a Delete label.

**Architecture:** Pure Sunday-week helpers feed a week-first capacity strip. Below `lg`, List view renders stacked cards that reuse a shared `ProcedureStageGrid`. Desktop keeps `DocketStageSheet`. A sticky `DocketToolbar` holds Bin / Capacity / New matter. Procedure toasts share one helper that offers Undo plus Log appearance.

**Tech Stack:** React 18, TypeScript, Tailwind (`lg` = 1024px), Sonner, existing `DocketStageCell` / `usePatchDocketProcedure`, Node test scripts via `scripts/test-support/register.mjs`.

## Global Constraints

- No user-facing em dashes; empty values stay `Not set` / `+ Set {column}`.
- Weeks start Sunday; never parse `YYYY-MM-DD` with `new Date(string)` — use `parseDateOnly` / `getLocalDateOnly` from `src/lib/utils.ts`.
- Do not change capacity colour bands or procedure vocabulary.
- Do not add a confirm dialog before recording a stage.
- Tiles stay available; cards are List below `lg` only.
- Default docket browse view stays `list`.
- No new tables or RPCs.

---

### Task 1: Sunday week helpers

**Files:**

- Create: `src/lib/docket-week.ts`
- Create: `scripts/tests/test-docket-week.mjs`
- Modify: `package.json` (add `test:docket-week`)

**Interfaces:**

- Consumes: `parseDateOnly`, `getLocalDateOnly` from `src/lib/utils.ts`
- Produces:
  - `weekStartSunday(isoDate: string): string`
  - `daysOfWeek(weekStartIso: string): string[]`
  - `addDaysIso(isoDate: string, days: number): string`
  - `weekOfLabel(weekStartIso: string): string`

- [ ] **Step 1: Write the failing test**

```js
import { weekStartSunday, daysOfWeek, addDaysIso, weekOfLabel } from "../../src/lib/docket-week.ts";

check("Wed 2 Sep 2026 week starts Sunday 30 Aug", weekStartSunday("2026-09-02"), "2026-08-30");
check("Sunday is its own week start", weekStartSunday("2026-08-30"), "2026-08-30");
check("daysOfWeek is seven local ISO dates", daysOfWeek("2026-08-30"), [
  "2026-08-30",
  "2026-08-31",
  "2026-09-01",
  "2026-09-02",
  "2026-09-03",
  "2026-09-04",
  "2026-09-05",
]);
check("addDaysIso +7 is next Sunday", addDaysIso("2026-08-30", 7), "2026-09-06");
check("weekOfLabel uses en-GB day month year", weekOfLabel("2026-08-30"), "Week of 30 Aug 2026");
```

- [ ] **Step 2: Run `npm run test:docket-week` — expect FAIL (module missing)**
- [ ] **Step 3: Implement `src/lib/docket-week.ts` with local Date math only**
- [ ] **Step 4: Run `npm run test:docket-week` — expect ALL PASS**
- [ ] **Step 5: Commit** `test(docket): add Sunday week helpers`

---

### Task 2: Week-first capacity strip

**Files:**

- Modify: `src/pages/docket/docket-capacity-strip.tsx`

**Interfaces:**

- Consumes: Task 1 helpers; existing `DayTile`, `buildMonthGrid`, `onSelectDate`
- Produces: default week strip; Month button `aria-expanded` + labelled region; week chevrons clear the date filter

- [ ] **Step 1: Default the strip to `daysOfWeek(weekStartSunday(selectedDate ?? today))`**
- [ ] **Step 2: Keep `weekAnchor` state for when `selectedDate` is null after week nav**
- [ ] **Step 3: Month button toggles the existing month grid; picking a day sets the filter and closes nothing required except jumping the week**
- [ ] **Step 4: Manual — week is the first chrome; Month reveals the month grid**
- [ ] **Step 5: Commit** `feat(docket): default capacity chrome to the current week`

---

### Task 3: Procedure undo toast helper

**Files:**

- Create: `src/lib/docket-procedure-log.ts`
- Modify: `src/pages/docket/docket-stage-sheet.tsx` (`handleChange`)
- Modify: `src/pages/docket/docket-stage-strip.tsx` (`handleChange`)

**Interfaces:**

- Consumes: `appearanceHintForColumn`, `toast` from `sonner`, patch that returns the updated row (`updated_at`)
- Produces: `notifyProcedureLogged({ column, previous, next, onUndo, onLogAppearance })`

```ts
export function notifyProcedureLogged(args: {
  column: ProcedureColumnKey;
  next: string;
  onUndo: () => void;
  onLogAppearance: (hint: { event_type: string; stage_at_event: string; notes: string }) => void;
}): void;
```

Undo `onClick` must patch `{ [column]: previous }` with `expectedUpdatedAt` from the successful mutate result. If Sonner will only show one extra button, show Undo.

- [ ] **Step 1: Add helper and switch both handleChange sites to it**
- [ ] **Step 2: Typecheck**
- [ ] **Step 3: Commit** `feat(docket): undo a procedure cell from the toast`

---

### Task 4: Shared stage grid + phone cards + sticky toolbar + copy

**Files:**

- Create: `src/pages/docket/procedure-stage-grid.tsx`
- Create: `src/pages/docket/docket-matter-card.tsx`
- Create: `src/pages/docket/docket-toolbar.tsx`
- Modify: `src/pages/docket/docket-stage-strip.tsx` (use grid)
- Modify: `src/pages/docket/docket-stage-cell.tsx` (optional `className` for `min-h-11`)
- Modify: `src/pages/docket/docket-list-page.tsx`
- Modify: `src/pages/docket/docket-stage-sheet.tsx` (remove swipe hint; keep `data-tour="docket-board"`)
- Modify: `src/pages/docket/docket-matter-detail-page.tsx` (Move to bin)
- Modify: `src/pages/docket/docket-bin-page.tsx` (binned copy)

**Interfaces:**

- Consumes: `DocketStageCell`, `NextDateCell`, `DocketMatterBoardRow`, `useIsDesktop` / `lg` via CSS `lg:hidden` / `hidden lg:block` preferred over JS when both layouts can mount
- Produces: cards below `lg` for List; spreadsheet at `lg+`; sticky toolbar

Prefer CSS split so both trees can exist: wrap sheet in `hidden lg:block`, cards in `lg:hidden`, still only render the active browse view (List vs Tiles).

Toolbar: `sticky top-[calc(68px+env(safe-area-inset-top))] z-40 bg-[#141414] py-2` with Bin, Capacity, New matter (`data-tour="docket-new-matter"`).

Phone cell: `className="min-h-11"` on `DocketStageCell`.

- [ ] **Step 1: Extract grid, cards, toolbar; wire list page; copy**
- [ ] **Step 2: `npm run typecheck` and `npm run test:docket-week` and `npm run test:docket-procedure`**
- [ ] **Step 3: Browser — ~390px cards no pan; ~1280px table; undo; Move to bin; New matter after scroll**
- [ ] **Step 4: Commit** `feat(docket): stack stages on a phone and pin New matter`

---

## Spec coverage

| Spec                                 | Task |
| ------------------------------------ | ---- |
| Week strip, Sunday, Month disclosure | 1–2  |
| Sticky toolbar / New matter          | 4    |
| Undo + Log appearance                | 3    |
| Move to bin copy                     | 4    |
| Phone 2×4 cards, desktop sheet       | 4    |
| Walkthrough copy / swipe hint        | 4    |
| `docket-week` tests                  | 1    |
