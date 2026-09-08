/**
 * Vocabulary for the Docket board's Outcome column (0131) — a matter's
 * disposition, settable at any procedure stage, distinct from the eight
 * left-to-right procedure columns (`docket-procedure.ts`). Kept as its
 * own small module rather than folded into that one, mirroring how
 * `callover.ts` and `docket-scope.ts` each own one narrow concern.
 *
 * Deliberately NOT the same field as `docket_matters.outcome` (a free-text
 * narrative shown on the Overview tab / Daily Progress Report) or
 * `docket_callover_items.outcome` (a callover appearance's own free-text
 * result, 0129). This is `outcome_status`: exactly two values, each of
 * which forces the matter's overall `status` to match (see the
 * `docket_matters_outcome_sync` trigger, 0131).
 */

export const OUTCOME_STATUSES = ["dismissed", "completed"] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export const OUTCOME_VALUE_LABELS: Record<OutcomeStatus, string> = {
  dismissed: "Dismissed",
  completed: "Completed",
};

export function isOutcomeStatus(value: unknown): value is OutcomeStatus {
  return typeof value === "string" && (OUTCOME_STATUSES as readonly string[]).includes(value);
}

export type OutcomeTone = "muted" | "dismissed" | "complete";

/** Red for dismissed, blue for completed, muted for no outcome recorded. */
export function outcomeTone(value: string | null | undefined): OutcomeTone {
  if (value === "dismissed") return "dismissed";
  if (value === "completed") return "complete";
  return "muted";
}

export function outcomeLabel(value: string | null | undefined): string {
  return isOutcomeStatus(value) ? OUTCOME_VALUE_LABELS[value] : "Not recorded";
}
