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

import type { WorkflowProtocol } from "@/lib/docket-procedure";

export const OUTCOME_STATUSES = ["dismissed", "completed"] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export const OUTCOME_VALUE_LABELS: Record<OutcomeStatus, string> = {
  dismissed: "Dismissed",
  completed: "Completed",
};

export const CIVIL_OUTCOME_ADJOURNED = "adjourned";

export function isOutcomeStatus(value: unknown): value is OutcomeStatus {
  return typeof value === "string" && (OUTCOME_STATUSES as readonly string[]).includes(value);
}

export type OutcomeTone = "muted" | "dismissed" | "complete" | "adjourned";

/** Red for dismissed, blue for completed, amber for civil adjourned, muted for no outcome recorded. */
export function outcomeTone(
  value: string | null | undefined,
  outcomeAdjourned = false,
): OutcomeTone {
  if (value === "dismissed") return "dismissed";
  if (value === "completed") return "complete";
  if (outcomeAdjourned || value === CIVIL_OUTCOME_ADJOURNED) return "adjourned";
  return "muted";
}

export function outcomeLabel(
  value: string | null | undefined,
  outcomeAdjourned = false,
): string {
  if (isOutcomeStatus(value)) return OUTCOME_VALUE_LABELS[value];
  if (outcomeAdjourned || value === CIVIL_OUTCOME_ADJOURNED) return "Adjourned";
  return "Not recorded";
}

export function outcomeOptionsForProtocol(
  protocol: WorkflowProtocol,
): { value: string; label: string }[] {
  if (protocol === "paper_committal") {
    // Dismissed belongs here for the same reason 0131 added the Outcome
    // column at all: a paper-committal board carries an Arraignment
    // column that accepts "Not Found, To Be Summoned", so the exact
    // situation Outcome exists to record — accused never found, matter
    // dismissed as wasting the court's time — is reachable on this board.
    // It previously offered "Completed" only, leaving that file with no
    // disposition to record and no way off the sheet. The 0131 CHECK
    // constraint already permits `dismissed` for every protocol; this was
    // a UI-only gap.
    //
    // Civil summons is deliberately NOT given Dismissed here: it has no
    // Arraignment column, so `not_found` is unreachable and the same
    // argument does not apply. Verified per protocol rather than assumed.
    return [
      { value: "completed", label: "Completed" },
      { value: "dismissed", label: "Dismissed" },
    ];
  }
  if (protocol === "civil_summons") {
    return [
      { value: "completed", label: "Completed" },
      { value: CIVIL_OUTCOME_ADJOURNED, label: "Adjourned" },
    ];
  }
  return OUTCOME_STATUSES.map((status) => ({
    value: status,
    label: OUTCOME_VALUE_LABELS[status],
  }));
}
