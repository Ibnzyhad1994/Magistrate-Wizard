/**
 * Criminal-procedure board vocabulary for the Docket spreadsheet.
 * CHECK constraints on docket_matters (migration 0070) must stay in sync.
 */

import { NOT_SET } from "@/lib/empty-display";

export const ARRAIGNMENT_STATUSES = ["not_started", "done"] as const;
export const CUSTODY_STATUSES = ["unset", "on_bail", "remanded"] as const;
export const DISCLOSURE_STATUSES = ["none", "partial", "full"] as const;
export const TRIAL_STATUSES = ["not_commenced", "partial", "completed"] as const;
export const RULING_STATUSES = ["not_started", "reserved", "delivered"] as const;
export const JUDGMENT_STATUSES = ["not_started", "reserved", "delivered"] as const;
export const SENTENCE_STATUSES = ["not_started", "passed"] as const;
export const APPEAL_STATUSES = ["not_started", "noted", "disposed"] as const;

export const PROCEDURE_STAGES = [
  "arraignment",
  "custody",
  "disclosure",
  "trial",
  "ruling",
  "judgment",
  "sentence",
  "appeal",
] as const;

export const NEXT_DATE_FILTERS = ["today", "upcoming", "no_date"] as const;

export type ArraignmentStatus = (typeof ARRAIGNMENT_STATUSES)[number];
export type CustodyStatus = (typeof CUSTODY_STATUSES)[number];
export type DisclosureStatus = (typeof DISCLOSURE_STATUSES)[number];
export type TrialStatus = (typeof TRIAL_STATUSES)[number];
export type RulingStatus = (typeof RULING_STATUSES)[number];
export type JudgmentStatus = (typeof JUDGMENT_STATUSES)[number];
export type SentenceStatus = (typeof SENTENCE_STATUSES)[number];
export type AppealStatus = (typeof APPEAL_STATUSES)[number];
export type ProcedureStage = (typeof PROCEDURE_STAGES)[number];
export type NextDateFilter = (typeof NEXT_DATE_FILTERS)[number];

export type ProcedureColumnKey =
  | "arraignment_status"
  | "custody_status"
  | "disclosure_status"
  | "trial_status"
  | "ruling_status"
  | "judgment_status"
  | "sentence_status"
  | "appeal_status";

export type ProcedureSnapshot = {
  arraignment_status: ArraignmentStatus;
  custody_status: CustodyStatus;
  disclosure_status: DisclosureStatus;
  trial_status: TrialStatus;
  ruling_status: RulingStatus;
  judgment_status: JudgmentStatus;
  sentence_status: SentenceStatus;
  appeal_status: AppealStatus;
};

export type ProcedureFilters = {
  stages: ProcedureStage[];
  custody: Array<Extract<CustodyStatus, "on_bail" | "remanded">>;
  disclosure: DisclosureStatus[];
  trial: TrialStatus[];
  nextDate: NextDateFilter[];
};

export const EMPTY_PROCEDURE_FILTERS: ProcedureFilters = {
  stages: [],
  custody: [],
  disclosure: [],
  trial: [],
  nextDate: [],
};

export const PROCEDURE_STAGE_LABELS: Record<ProcedureStage, string> = {
  arraignment: "Arraignment",
  custody: "Custody",
  disclosure: "Disclosure",
  trial: "Trial",
  ruling: "Ruling",
  judgment: "Judgment",
  sentence: "Sentence",
  appeal: "Appeal",
};

export const NEXT_DATE_LABELS: Record<NextDateFilter, string> = {
  today: "Today",
  upcoming: "Upcoming",
  no_date: "No date",
};

export const PROCEDURE_VALUE_LABELS: Record<string, string> = {
  not_started: "Not started",
  done: "Done",
  unset: NOT_SET,
  on_bail: "On bail",
  remanded: "Remanded",
  none: "No disclosure",
  partial: "Partial",
  full: "Full",
  not_commenced: "Not commenced",
  completed: "Completed",
  reserved: "Reserved",
  delivered: "Delivered",
  passed: "Passed",
  noted: "Noted",
  disposed: "Disposed",
};

export const PROCEDURE_COLUMNS: ReadonlyArray<{
  key: ProcedureColumnKey;
  stage: ProcedureStage;
  label: string;
  values: readonly string[];
  emptyValue: string;
}> = [
  {
    key: "arraignment_status",
    stage: "arraignment",
    label: "Arraignment",
    values: ARRAIGNMENT_STATUSES,
    emptyValue: "not_started",
  },
  {
    key: "custody_status",
    stage: "custody",
    label: "Custody",
    values: CUSTODY_STATUSES,
    emptyValue: "unset",
  },
  {
    key: "disclosure_status",
    stage: "disclosure",
    label: "Disclosure",
    values: DISCLOSURE_STATUSES,
    emptyValue: "none",
  },
  {
    key: "trial_status",
    stage: "trial",
    label: "Trial",
    values: TRIAL_STATUSES,
    emptyValue: "not_commenced",
  },
  {
    key: "ruling_status",
    stage: "ruling",
    label: "Ruling",
    values: RULING_STATUSES,
    emptyValue: "not_started",
  },
  {
    key: "judgment_status",
    stage: "judgment",
    label: "Judgment",
    values: JUDGMENT_STATUSES,
    emptyValue: "not_started",
  },
  {
    key: "sentence_status",
    stage: "sentence",
    label: "Sentence",
    values: SENTENCE_STATUSES,
    emptyValue: "not_started",
  },
  {
    key: "appeal_status",
    stage: "appeal",
    label: "Appeal",
    values: APPEAL_STATUSES,
    emptyValue: "not_started",
  },
];

/** Walks left to right. Keep in sync with the generated procedure_stage column. */
export function currentStage(row: ProcedureSnapshot): ProcedureStage {
  if (row.arraignment_status !== "done") return "arraignment";
  if (row.custody_status === "unset") return "custody";
  if (row.disclosure_status !== "full") return "disclosure";
  if (row.trial_status !== "completed") return "trial";
  if (row.ruling_status !== "delivered") return "ruling";
  if (row.judgment_status !== "delivered") return "judgment";
  if (row.sentence_status !== "passed") return "sentence";
  return "appeal";
}

/**
 * `currentStage()` for a raw `docket_matters` row — the procedure-status
 * columns are plain `text` in the database (not enums, see 0070), so
 * every caller needs the same cast-to-ProcedureSnapshot adapter. Shared
 * here rather than re-written per call site (docket-stage-strip.tsx,
 * overview-section.tsx, hearing-progress-section.tsx).
 */
export function matterCurrentStage(matter: {
  arraignment_status: string;
  custody_status: string;
  disclosure_status: string;
  trial_status: string;
  ruling_status: string;
  judgment_status: string;
  sentence_status: string;
  appeal_status: string;
}): ProcedureStage {
  return currentStage({
    arraignment_status: matter.arraignment_status as ArraignmentStatus,
    custody_status: matter.custody_status as CustodyStatus,
    disclosure_status: matter.disclosure_status as DisclosureStatus,
    trial_status: matter.trial_status as TrialStatus,
    ruling_status: matter.ruling_status as RulingStatus,
    judgment_status: matter.judgment_status as JudgmentStatus,
    sentence_status: matter.sentence_status as SentenceStatus,
    appeal_status: matter.appeal_status as AppealStatus,
  });
}

export function activeProcedureFilterCount(filters: ProcedureFilters): number {
  return (
    filters.stages.length +
    filters.custody.length +
    filters.disclosure.length +
    filters.trial.length +
    filters.nextDate.length
  );
}

export function hasActiveProcedureFilters(filters: ProcedureFilters): boolean {
  return activeProcedureFilterCount(filters) > 0;
}

export function toggleFilterValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function matchesProcedureFilters(
  row: ProcedureSnapshot & { next_appearance: string | null },
  filters: ProcedureFilters,
  today: string,
): boolean {
  if (filters.stages.length > 0 && !filters.stages.includes(currentStage(row))) {
    return false;
  }
  if (filters.custody.length > 0 && !filters.custody.includes(row.custody_status as "on_bail" | "remanded")) {
    return false;
  }
  if (filters.disclosure.length > 0 && !filters.disclosure.includes(row.disclosure_status)) {
    return false;
  }
  if (filters.trial.length > 0 && !filters.trial.includes(row.trial_status)) {
    return false;
  }
  if (filters.nextDate.length > 0) {
    const next = row.next_appearance;
    const hit =
      (filters.nextDate.includes("today") && next === today) ||
      (filters.nextDate.includes("upcoming") && next != null && next > today) ||
      (filters.nextDate.includes("no_date") && next == null);
    if (!hit) return false;
  }
  return true;
}

const MUTED_VALUES = new Set(["not_started", "unset"]);

export function isProcedureEmptyValue(value: string): boolean {
  return MUTED_VALUES.has(value);
}

export type ProcedureCellLabelOpts = {
  column?: ProcedureColumnKey;
  canEdit?: boolean;
};

export const procedureSetLabel = (column: ProcedureColumnKey): string => {
  const name = PROCEDURE_COLUMNS.find((c) => c.key === column)?.label ?? "status";
  return `+ Set ${name.toLowerCase()}`;
};

export function procedureCellLabel(value: string, opts?: ProcedureCellLabelOpts): string {
  if (isProcedureEmptyValue(value)) {
    if (opts?.canEdit && opts.column) return procedureSetLabel(opts.column);
    return NOT_SET;
  }
  return PROCEDURE_VALUE_LABELS[value] ?? value;
}

export type ProcedureCellTone = "muted" | "progress" | "done" | "remand";

export function procedureCellTone(column: ProcedureColumnKey, value: string): ProcedureCellTone {
  if (value === "remanded") return "remand";
  if (isProcedureEmptyValue(value)) return "muted";
  if (
    value === "done" ||
    value === "full" ||
    value === "completed" ||
    value === "delivered" ||
    value === "passed" ||
    value === "disposed"
  ) {
    return "done";
  }
  void column;
  return "progress";
}

export function procedureCellMode(canEdit: boolean): "edit" | "read" {
  return canEdit ? "edit" : "read";
}

/** Values shown in the cell popover. Empty defaults are reached via Clear, except Disclosure/Trial where every state is a real result. */
export function procedureSelectableValues(key: ProcedureColumnKey): { value: string; label: string }[] {
  const column = PROCEDURE_COLUMNS.find((c) => c.key === key);
  if (!column) return [];
  const includeEmpty = key === "disclosure_status" || key === "trial_status";
  return column.values
    .filter((value) => includeEmpty || value !== column.emptyValue)
    .map((value) => ({ value, label: procedureCellLabel(value) }));
}

export function procedureHasClear(key: ProcedureColumnKey): boolean {
  return key !== "disclosure_status" && key !== "trial_status";
}

export function procedureEmptyValue(key: ProcedureColumnKey): string {
  return PROCEDURE_COLUMNS.find((c) => c.key === key)?.emptyValue ?? "not_started";
}

export function appearanceHintForColumn(
  column: ProcedureColumnKey,
  value: string,
): { event_type: string; stage_at_event: string; notes: string } {
  const label = procedureCellLabel(value);
  switch (column) {
    case "arraignment_status":
      return { event_type: "Arraignment", stage_at_event: "First Appearance", notes: `Arraignment: ${label}` };
    case "custody_status":
      return { event_type: "Bail", stage_at_event: "First Appearance", notes: `Custody: ${label}` };
    case "disclosure_status":
      return { event_type: "Disclosure", stage_at_event: "Case Management", notes: `Disclosure: ${label}` };
    case "trial_status":
      return { event_type: "Trial", stage_at_event: "Trial", notes: `Trial: ${label}` };
    case "ruling_status":
      return { event_type: "Decision/Judgment", stage_at_event: "Decision", notes: `Ruling: ${label}` };
    case "judgment_status":
      return { event_type: "Decision/Judgment", stage_at_event: "Decision", notes: `Judgment: ${label}` };
    case "sentence_status":
      return { event_type: "Sentencing", stage_at_event: "Sentencing", notes: `Sentence: ${label}` };
    case "appeal_status":
      return { event_type: "Review", stage_at_event: "Enforcement", notes: `Appeal: ${label}` };
  }
}

export function filtersToRpcArgs(filters: ProcedureFilters): {
  p_procedure_stages?: string[];
  p_custody?: string[];
  p_disclosure?: string[];
  p_trial?: string[];
  p_next_date?: string[];
} {
  return {
    ...(filters.stages.length ? { p_procedure_stages: [...filters.stages] } : {}),
    ...(filters.custody.length ? { p_custody: [...filters.custody] } : {}),
    ...(filters.disclosure.length ? { p_disclosure: [...filters.disclosure] } : {}),
    ...(filters.trial.length ? { p_trial: [...filters.trial] } : {}),
    ...(filters.nextDate.length ? { p_next_date: [...filters.nextDate] } : {}),
  };
}
