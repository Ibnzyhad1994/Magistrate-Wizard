/**
 * Callover vocabulary and pure list logic.
 *
 * Framework-free and side-effect-free so the running sheet's rules can be
 * unit tested without a router, a query client, or a live database —
 * matching `docket-scope.ts` / `docket-board-params.ts`.
 *
 * `outcome` is stored as unconstrained `text` (0129), deliberately, for
 * the same reason `docket_events.event_type` is (0024): the list below is
 * a UI convenience, not a database constraint, so any pre-existing or
 * future wording stays representable and is never coerced onto the
 * nearest canonical term.
 */

import type { ProcedureStage } from "@/lib/docket-procedure";

export const CALLOVER_STATUSES = ["draft", "in_progress", "completed"] as const;
export type CalloverStatus = (typeof CALLOVER_STATUSES)[number];

export const CALLOVER_STATUS_LABELS: Record<CalloverStatus, string> = {
  draft: "Draft",
  in_progress: "In progress",
  completed: "Completed",
};

export function isCalloverStatus(value: unknown): value is CalloverStatus {
  return typeof value === "string" && (CALLOVER_STATUSES as readonly string[]).includes(value);
}

/**
 * A completed callover is a record of a sitting, so the running sheet
 * stops accepting edits. It is not frozen forever — the UI offers an
 * explicit Reopen (back to `in_progress`), which is audited like any
 * other change, rather than silently permitting edits to a closed record.
 */
export function isCalloverEditable(status: string | null | undefined): boolean {
  return status !== "completed";
}

/**
 * What a matter's disposal at the callover was. `expectsNextDate` drives
 * a nudge in the UI, never a hard requirement — a magistrate may
 * legitimately adjourn without fixing a date on the spot.
 *
 * `suggestsCompletion` marks the outcomes that USUALLY end a matter. It
 * only ever surfaces an opt-in "also mark this matter completed"
 * checkbox: an outcome never mutates docket_matter_status by itself
 * (0129's own header states this), because silently completing a
 * judicial file from a dropdown is the wrong default.
 */
export type CalloverOutcomeMeta = {
  value: string;
  expectsNextDate: boolean;
  suggestsCompletion: boolean;
};

export const CALLOVER_OUTCOMES: readonly CalloverOutcomeMeta[] = [
  { value: "Called", expectsNextDate: false, suggestsCompletion: false },
  { value: "Adjourned", expectsNextDate: true, suggestsCompletion: false },
  { value: "Trial date set", expectsNextDate: true, suggestsCompletion: false },
  { value: "Part-heard", expectsNextDate: true, suggestsCompletion: false },
  { value: "Committed", expectsNextDate: true, suggestsCompletion: false },
  { value: "Warrant issued", expectsNextDate: true, suggestsCompletion: false },
  { value: "No appearance", expectsNextDate: true, suggestsCompletion: false },
  { value: "Struck out", expectsNextDate: false, suggestsCompletion: true },
  { value: "Withdrawn", expectsNextDate: false, suggestsCompletion: true },
  { value: "Concluded", expectsNextDate: false, suggestsCompletion: true },
  { value: "Not called", expectsNextDate: false, suggestsCompletion: false },
];

export const CALLOVER_OUTCOME_VALUES: readonly string[] = CALLOVER_OUTCOMES.map((o) => o.value);

/** Metadata for a known outcome. Unknown/free-text outcomes are valid and simply carry no hints. */
export function calloverOutcomeMeta(outcome: string | null | undefined): CalloverOutcomeMeta | null {
  if (!outcome) return null;
  return CALLOVER_OUTCOMES.find((o) => o.value === outcome) ?? null;
}

export function outcomeExpectsNextDate(outcome: string | null | undefined): boolean {
  return calloverOutcomeMeta(outcome)?.expectsNextDate ?? false;
}

export function outcomeSuggestsCompletion(outcome: string | null | undefined): boolean {
  return calloverOutcomeMeta(outcome)?.suggestsCompletion ?? false;
}

/**
 * A row on the running sheet. Deliberately structural rather than the
 * generated database Row type so this module stays framework- and
 * schema-import-free for the unit test.
 */
export type CalloverItemLike = {
  id: string;
  sort_order: number;
  called_at: string | null;
  outcome: string | null;
  next_date: string | null;
  created_at?: string | null;
};

/**
 * Display order: as listed, with `created_at` breaking ties so two items
 * sharing a sort_order never swap places between renders. Never reorders
 * by called/uncalled — a magistrate reads the list in the order it is
 * called, and having rows jump as they are dealt with would lose their place.
 */
export function sortCalloverItems<T extends CalloverItemLike>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
}

export type CalloverProgress = {
  total: number;
  called: number;
  remaining: number;
  /** 0–100, rounded. 0 for an empty list rather than NaN. */
  percent: number;
};

export function calloverProgress(items: readonly CalloverItemLike[]): CalloverProgress {
  const total = items.length;
  const called = items.filter((i) => i.called_at !== null).length;
  return {
    total,
    called,
    remaining: total - called,
    percent: total === 0 ? 0 : Math.round((called / total) * 100),
  };
}

/**
 * Rows worth flagging before a sitting is marked complete: called, given
 * an outcome that normally fixes a return date, but left without one.
 * Surfaced as a confirmation, never a block — see outcomeExpectsNextDate.
 */
export function itemsMissingExpectedNextDate<T extends CalloverItemLike>(
  items: readonly T[],
): T[] {
  return items.filter(
    (i) => i.called_at !== null && outcomeExpectsNextDate(i.outcome) && !i.next_date,
  );
}

/** Default title for a new sitting, e.g. "Callover — 11 September 2026". */
export function defaultCalloverTitle(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "Callover";
  return `Callover — ${parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  })}`;
}

/**
 * Human label for where a brought-forward matter will land on the board,
 * so the intake form can say so before saving rather than leaving the
 * magistrate to discover it afterwards. Takes the stage `currentStage()`
 * computed, keeping the single source of truth in docket-procedure.ts.
 */
export function broughtForwardStageNotice(stage: ProcedureStage, stageLabel: string): string {
  return stage === "arraignment"
    ? `This matter will appear at ${stageLabel}, the start of the board.`
    : `This matter will appear at ${stageLabel}, not at the start of the board.`;
}
