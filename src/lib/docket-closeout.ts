/**
 * End-of-day close-out: which of today's listed files still need
 * something before the day is written up.
 *
 * Built entirely from the rows the board already fetched for that date
 * (`list_docket_matters(p_exact_date)`), NOT a separate query. That is
 * deliberate: a second RPC with its own membership rule would drift from
 * the list it claims to summarise, which is exactly the class of bug
 * 0147 to 0148 had to correct. Same rows, same RLS, by construction.
 *
 * It reads the APPEARANCE outcome (`appearance_outcome`, from
 * docket_events), never `docket_matters.outcome_status`. Those are two
 * different fields -- what happened at one sitting, versus how the whole
 * matter ended -- and conflating them would be a silent data bug.
 */

export type CloseoutRow = {
  id: string;
  case_number: string;
  matter_title: string;
  appearance_status: string | null;
  appearance_outcome: string | null;
  next_appearance: string | null;
  can_edit: boolean;
};

export type CloseoutState = "no_outcome" | "no_next_date" | "both" | "ready";

export type CloseoutEntry = CloseoutRow & { state: CloseoutState };

const blank = (value: string | null) => !value || value.trim() === "";

/**
 * A listed file needs attention if the sitting has no recorded outcome,
 * or nothing is scheduled after this day, or both.
 *
 * `scheduled` means the appearance has not been dealt with; a cancelled
 * one needs nothing. The next date is judged against the day being closed
 * out, so an appearance later the SAME day does not count as "what
 * happens next".
 */
export function classifyCloseout(row: CloseoutRow, closingDate: string): CloseoutState {
  const needsOutcome = row.appearance_status === "scheduled" && blank(row.appearance_outcome);
  const needsNextDate = !row.next_appearance || row.next_appearance <= closingDate;
  if (needsOutcome && needsNextDate) return "both";
  if (needsOutcome) return "no_outcome";
  if (needsNextDate) return "no_next_date";
  return "ready";
}

export function closeoutEntries(rows: CloseoutRow[], closingDate: string): CloseoutEntry[] {
  return rows.map((row) => ({ ...row, state: classifyCloseout(row, closingDate) }));
}

export type CloseoutSummary = {
  total: number;
  needingAttention: number;
  missingOutcome: number;
  missingNextDate: number;
};

export function summariseCloseout(entries: CloseoutEntry[]): CloseoutSummary {
  return {
    total: entries.length,
    needingAttention: entries.filter((e) => e.state !== "ready").length,
    missingOutcome: entries.filter((e) => e.state === "no_outcome" || e.state === "both").length,
    missingNextDate: entries.filter((e) => e.state === "no_next_date" || e.state === "both").length,
  };
}

/**
 * The line that answers the audit's actual complaint about
 * run_scheduled_maintenance: the 06:00 cron flips elapsed `scheduled`
 * appearances to `past` with no outcome, silently. Saying so beforehand
 * is the whole point of the panel.
 */
export function overnightWarning(summary: CloseoutSummary): string | null {
  if (summary.missingOutcome === 0) return null;
  const n = summary.missingOutcome;
  return n === 1
    ? "At 6am tomorrow, 1 appearance still marked scheduled will be recorded as past with no outcome."
    : `At 6am tomorrow, ${n} appearances still marked scheduled will be recorded as past with no outcome.`;
}

/** What the Daily Progress Report would print for the same files. */
export function reportWarning(summary: CloseoutSummary): string | null {
  if (summary.missingOutcome === 0) return null;
  return summary.missingOutcome === 1
    ? "1 matter would print as \u201cNot recorded\u201d on the daily report."
    : `${summary.missingOutcome} matters would print as \u201cNot recorded\u201d on the daily report.`;
}
