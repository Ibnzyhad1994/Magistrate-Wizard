/**
 * Procedure-board vocabulary for the Docket spreadsheet.
 * Criminal Trial CHECKs (0070/0131) and protocol columns (0140) must stay
 * in sync with this file and `currentStageForProtocol()` in docket-protocols.ts.
 */

import { NOT_SET } from "@/lib/empty-display";

/**
 * 'not_found' (0131): the accused was not found and needs to be
 * (re-)summoned. Still counts as arraignment not done for
 * `currentStage()`/`procedure_stage` purposes -- the matter stays at the
 * Arraignment stage, distinct from a matter that's never been attempted.
 */
export const ARRAIGNMENT_STATUSES = ["not_started", "done", "not_found"] as const;
export const CUSTODY_STATUSES = ["unset", "on_bail", "remanded"] as const;
export const DISCLOSURE_STATUSES = ["none", "partial", "full"] as const;
export const TRIAL_STATUSES = ["not_commenced", "partial", "completed"] as const;
export const RULING_STATUSES = ["not_started", "reserved", "delivered"] as const;
export const JUDGMENT_STATUSES = ["not_started", "reserved", "delivered"] as const;
export const SENTENCE_STATUSES = ["not_started", "passed"] as const;
export const APPEAL_STATUSES = ["not_started", "noted", "disposed"] as const;
export const PAPER_COMMITTAL_STATUSES = [
  "not_commenced",
  "commenced",
  "partial",
  "completed",
] as const;
export const YES_NO_STATUSES = ["unset", "yes", "no"] as const;
export const INFORMATION_SWORN_STATUSES = ["not_started", "done"] as const;
export const DECISION_GRANTED_STATUSES = ["granted", "not_granted"] as const;

export const WORKFLOW_PROTOCOLS = [
  "criminal_trial",
  "paper_committal",
  "civil_summons",
] as const;

export const PROCEDURE_STAGES = [
  "arraignment",
  "custody",
  "disclosure",
  "trial",
  "paper_committal",
  "ruling",
  "judgment",
  "sentence",
  "appeal",
  "information_sworn",
  "summons_served",
  "returns_of_summons",
  "civil_trial",
  "decision",
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
export type PaperCommittalStatus = (typeof PAPER_COMMITTAL_STATUSES)[number];
export type YesNoStatus = (typeof YES_NO_STATUSES)[number];
export type InformationSwornStatus = (typeof INFORMATION_SWORN_STATUSES)[number];
export type DecisionGrantedStatus = (typeof DECISION_GRANTED_STATUSES)[number];
export type WorkflowProtocol = (typeof WORKFLOW_PROTOCOLS)[number];
export type ProcedureStage = (typeof PROCEDURE_STAGES)[number];
export type NextDateFilter = (typeof NEXT_DATE_FILTERS)[number];

export type ProcedureColumnKey =
  | "arraignment_status"
  | "custody_status"
  | "disclosure_status"
  | "trial_status"
  | "paper_committal_status"
  | "ruling_status"
  | "judgment_status"
  | "sentence_status"
  | "appeal_status"
  | "information_sworn_status"
  | "summons_served"
  | "returns_of_summons"
  | "civil_trial_held"
  | "decision";

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
  paper_committal: "Paper Committal",
  ruling: "Ruling",
  judgment: "Judgment",
  sentence: "Sentence",
  appeal: "Appeal",
  information_sworn: "Information Sworn",
  summons_served: "Summons Served",
  returns_of_summons: "Returns of Summons",
  civil_trial: "Trial (Yes/No)",
  decision: "Decision",
};

export function procedureStageLabel(stage: string | null | undefined): string {
  if (!stage) return NOT_SET;
  return PROCEDURE_STAGE_LABELS[stage as ProcedureStage] ?? stage.replace(/_/g, " ");
}

export const NEXT_DATE_LABELS: Record<NextDateFilter, string> = {
  today: "Today",
  upcoming: "Upcoming",
  no_date: "No date",
};

export const PROCEDURE_VALUE_LABELS: Record<string, string> = {
  not_started: "Not started",
  done: "Done",
  not_found: "Not Found, To Be Summoned",
  unset: NOT_SET,
  on_bail: "On bail",
  remanded: "Remanded",
  none: "No disclosure",
  partial: "Partial",
  full: "Full",
  not_commenced: "Not commenced",
  commenced: "Commenced",
  completed: "Completed",
  reserved: "Reserved",
  delivered: "Delivered",
  passed: "Passed",
  noted: "Noted",
  disposed: "Disposed",
  yes: "Yes",
  no: "No",
  granted: "Granted",
  not_granted: "Not granted",
};

export type BoardColumnKind = "status" | "yesno" | "amount" | "decision";

export type BoardColumn = {
  key: ProcedureColumnKey;
  stage: ProcedureStage;
  label: string;
  values: readonly string[];
  emptyValue: string;
  protocols: readonly WorkflowProtocol[];
  kind: BoardColumnKind;
};

export const BOARD_COLUMNS: ReadonlyArray<BoardColumn> = [
  {
    key: "arraignment_status",
    stage: "arraignment",
    label: "Arraignment",
    values: ARRAIGNMENT_STATUSES,
    emptyValue: "not_started",
    protocols: ["criminal_trial", "paper_committal"],
    kind: "status",
  },
  {
    key: "custody_status",
    stage: "custody",
    label: "Custody",
    values: CUSTODY_STATUSES,
    emptyValue: "unset",
    protocols: ["criminal_trial", "paper_committal"],
    kind: "status",
  },
  {
    key: "disclosure_status",
    stage: "disclosure",
    label: "Disclosure",
    values: DISCLOSURE_STATUSES,
    emptyValue: "none",
    protocols: ["criminal_trial", "paper_committal"],
    kind: "status",
  },
  {
    key: "trial_status",
    stage: "trial",
    label: "Trial",
    values: TRIAL_STATUSES,
    emptyValue: "not_commenced",
    protocols: ["criminal_trial"],
    kind: "status",
  },
  {
    key: "paper_committal_status",
    stage: "paper_committal",
    label: "Paper Committal",
    values: PAPER_COMMITTAL_STATUSES,
    emptyValue: "not_commenced",
    protocols: ["paper_committal"],
    kind: "status",
  },
  {
    key: "ruling_status",
    stage: "ruling",
    label: "Ruling",
    values: RULING_STATUSES,
    emptyValue: "not_started",
    protocols: ["criminal_trial", "paper_committal"],
    kind: "status",
  },
  {
    key: "judgment_status",
    stage: "judgment",
    label: "Judgment",
    values: JUDGMENT_STATUSES,
    emptyValue: "not_started",
    protocols: ["criminal_trial", "paper_committal"],
    kind: "status",
  },
  {
    key: "sentence_status",
    stage: "sentence",
    label: "Sentence",
    values: SENTENCE_STATUSES,
    emptyValue: "not_started",
    protocols: ["criminal_trial"],
    kind: "status",
  },
  {
    key: "appeal_status",
    stage: "appeal",
    label: "Appeal",
    values: APPEAL_STATUSES,
    emptyValue: "not_started",
    protocols: ["criminal_trial", "paper_committal"],
    kind: "status",
  },
  {
    key: "information_sworn_status",
    stage: "information_sworn",
    label: "Information Sworn",
    values: INFORMATION_SWORN_STATUSES,
    emptyValue: "not_started",
    protocols: ["civil_summons"],
    kind: "status",
  },
  {
    key: "summons_served",
    stage: "summons_served",
    label: "Summons Served",
    values: YES_NO_STATUSES,
    emptyValue: "unset",
    protocols: ["civil_summons"],
    kind: "yesno",
  },
  {
    key: "returns_of_summons",
    stage: "returns_of_summons",
    label: "Returns of Summons",
    values: YES_NO_STATUSES,
    emptyValue: "unset",
    protocols: ["civil_summons"],
    kind: "yesno",
  },
  {
    key: "civil_trial_held",
    stage: "civil_trial",
    label: "Trial",
    values: YES_NO_STATUSES,
    emptyValue: "unset",
    protocols: ["civil_summons"],
    kind: "yesno",
  },
  {
    key: "decision",
    stage: "decision",
    label: "Decision",
    values: DECISION_GRANTED_STATUSES,
    emptyValue: "",
    protocols: ["civil_summons"],
    kind: "decision",
  },
];

/** Criminal Trial columns only. Tour example and brought-forward default. */
export const PROCEDURE_COLUMNS: ReadonlyArray<BoardColumn> = BOARD_COLUMNS.filter((column) =>
  column.protocols.includes("criminal_trial"),
);

export function protocolColumns(protocol: WorkflowProtocol): BoardColumn[] {
  return BOARD_COLUMNS.filter((column) => column.protocols.includes(protocol));
}

export function columnApplies(column: BoardColumn, protocol: WorkflowProtocol): boolean {
  return column.protocols.includes(protocol);
}

export function isWorkflowProtocol(value: unknown): value is WorkflowProtocol {
  return typeof value === "string" && (WORKFLOW_PROTOCOLS as readonly string[]).includes(value);
}

export function visibleBoardColumns(
  rows: Array<{ workflow_protocol?: string | null }>,
): BoardColumn[] {
  const protocols = new Set<WorkflowProtocol>();
  for (const row of rows) {
    protocols.add(isWorkflowProtocol(row.workflow_protocol) ? row.workflow_protocol : "criminal_trial");
  }
  if (protocols.size === 0) protocols.add("criminal_trial");
  return BOARD_COLUMNS.filter((column) =>
    column.protocols.some((protocol) => protocols.has(protocol)),
  );
}

function findColumn(key: ProcedureColumnKey): BoardColumn | undefined {
  return BOARD_COLUMNS.find((column) => column.key === key);
}

/** Walks left to right on the Criminal Trial board. Keep in sync with 0140. */
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
 * Criminal-only walk for a raw row. Protocol-aware callers should use
 * `matterCurrentStage` from docket-protocols.ts.
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

const MUTED_VALUES = new Set(["not_started", "unset", ""]);

export function isProcedureEmptyValue(value: string): boolean {
  return MUTED_VALUES.has(value);
}

export type ProcedureCellLabelOpts = {
  column?: ProcedureColumnKey;
  canEdit?: boolean;
  protocol?: WorkflowProtocol;
};

export const procedureSetLabel = (column: ProcedureColumnKey): string => {
  const name = findColumn(column)?.label ?? "status";
  return `+ Set ${name.toLowerCase()}`;
};

export function procedureCellLabel(value: string, opts?: ProcedureCellLabelOpts): string {
  if (opts?.protocol === "paper_committal" && value === "on_bail") return "Bail";
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
    value === "disposed" ||
    value === "yes" ||
    value === "granted" ||
    value === "not_granted"
  ) {
    return "done";
  }
  void column;
  return "progress";
}

export function procedureCellMode(canEdit: boolean): "edit" | "read" {
  return canEdit ? "edit" : "read";
}

/** Values shown in the cell popover. Empty defaults are reached via Clear, except Disclosure/Trial/Yes-No/Paper Committal where every listed state is a real result. */
export function procedureSelectableValues(
  key: ProcedureColumnKey,
  protocol?: WorkflowProtocol,
): { value: string; label: string }[] {
  const column = findColumn(key);
  if (!column) return [];
  if (column.kind === "decision" || column.kind === "amount") return [];
  const includeEmpty =
    key === "disclosure_status" ||
    key === "trial_status" ||
    key === "paper_committal_status" ||
    column.kind === "yesno";
  return column.values
    .filter((value) => {
      if (includeEmpty) {
        if (key === "paper_committal_status" && value === "not_commenced") return false;
        if (column.kind === "yesno" && value === "unset") return false;
        return true;
      }
      return value !== column.emptyValue;
    })
    .map((value) => ({
      value,
      label: procedureCellLabel(value, { column: key, protocol }),
    }));
}

/**
 * Whether the cell offers a "Clear" item.
 *
 * Disclosure and Trial are excluded because they already list their own
 * empty state as a selectable value — offering Clear as well would be two
 * controls for one outcome.
 *
 * Yes/No columns and Paper Committal are NOT excluded, despite deliberately
 * keeping their empty value out of the menu (procedureSelectableValues,
 * above). Those two rules used to be the same rule, which made four columns
 * one-way doors: set Summons Served to "Yes" by mistake and there was no
 * path back except the Undo on a 10-second toast. Dismiss it, switch tabs,
 * or notice the next morning and the value was permanent.
 *
 * They are different questions. Leaving "unset" out of the menu says it
 * isn't a real result worth choosing — which is right. Offering Clear says
 * the entry can be withdrawn — which must always be true for a value a
 * human typed in. Clear is already hidden when the cell is empty (see
 * DocketStageCell), so this adds nothing to an untouched cell.
 */
export function procedureHasClear(key: ProcedureColumnKey): boolean {
  const column = findColumn(key);
  if (!column) return true;
  return key !== "disclosure_status" && key !== "trial_status";
}

export function procedureEmptyValue(key: ProcedureColumnKey): string {
  return findColumn(key)?.emptyValue ?? "not_started";
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
    case "paper_committal_status":
      return { event_type: "Paper Committal", stage_at_event: "Paper Committal", notes: `Paper Committal: ${label}` };
    case "ruling_status":
      return { event_type: "Decision/Judgment", stage_at_event: "Decision", notes: `Ruling: ${label}` };
    case "judgment_status":
      return { event_type: "Decision/Judgment", stage_at_event: "Decision", notes: `Judgment: ${label}` };
    case "sentence_status":
      return { event_type: "Sentencing", stage_at_event: "Sentencing", notes: `Sentence: ${label}` };
    case "appeal_status":
      return { event_type: "Review", stage_at_event: "Enforcement", notes: `Appeal: ${label}` };
    case "information_sworn_status":
      return { event_type: "First Appearance", stage_at_event: "Information Sworn", notes: `Information Sworn: ${label}` };
    case "summons_served":
      return { event_type: "Service", stage_at_event: "Summons Served", notes: `Summons Served: ${label}` };
    case "returns_of_summons":
      return { event_type: "Service", stage_at_event: "Returns of Summons", notes: `Returns of Summons: ${label}` };
    case "civil_trial_held":
      return { event_type: "Trial", stage_at_event: "Trial", notes: `Trial: ${label}` };
    case "decision":
      return { event_type: "Decision/Judgment", stage_at_event: "Decision", notes: `Decision: ${label}` };
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
