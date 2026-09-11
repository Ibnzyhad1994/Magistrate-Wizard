/**
 * Classification-specific Docket boards. SQL trigger
 * `docket_matters_set_workflow_protocol` (0140) must stay in lockstep with
 * `currentStageForProtocol()` here.
 */

import {
  BOARD_COLUMNS,
  currentStage as criminalCurrentStage,
  isWorkflowProtocol,
  type AppealStatus,
  type ArraignmentStatus,
  type CustodyStatus,
  type DecisionGrantedStatus,
  type DisclosureStatus,
  type InformationSwornStatus,
  type JudgmentStatus,
  type PaperCommittalStatus,
  type ProcedureColumnKey,
  type ProcedureSnapshot,
  type ProcedureStage,
  type RulingStatus,
  type SentenceStatus,
  type TrialStatus,
  type WorkflowProtocol,
  type YesNoStatus,
} from "@/lib/docket-procedure";

export type { WorkflowProtocol };

export const PAPER_COMMITTAL_CATEGORY_NAME = "Paper Committal";
export const CRIMINAL_TRIAL_CATEGORY_NAME = "Criminal trial";
export const MAINTENANCE_CATEGORY_NAME = "Maintenance matter";
export const LIABILITY_CATEGORY_NAME = "Liability matter";
export const PROTECTION_CATEGORY_NAME = "Protection order matter";

const CIVIL_CATEGORY_NAMES = new Set([
  MAINTENANCE_CATEGORY_NAME,
  LIABILITY_CATEGORY_NAME,
  PROTECTION_CATEGORY_NAME,
]);

export function protocolFromCategoryName(
  name: string | null | undefined,
): WorkflowProtocol {
  if (name === PAPER_COMMITTAL_CATEGORY_NAME) return "paper_committal";
  if (name && CIVIL_CATEGORY_NAMES.has(name)) return "civil_summons";
  return "criminal_trial";
}

export type StageAdjournment = {
  adjourned: boolean;
  reason: string;
};

export type StageAdjournments = Partial<Record<string, StageAdjournment>>;

export type ProtocolSnapshot = ProcedureSnapshot & {
  paper_committal_status: PaperCommittalStatus;
  information_sworn_status: InformationSwornStatus;
  summons_served: YesNoStatus;
  returns_of_summons: YesNoStatus;
  civil_trial_held: YesNoStatus;
  decision_granted: DecisionGrantedStatus | null;
  decision_amount: number | null;
};

export const EMPTY_PROTOCOL_SNAPSHOT: ProtocolSnapshot = {
  arraignment_status: "not_started",
  custody_status: "unset",
  disclosure_status: "none",
  trial_status: "not_commenced",
  ruling_status: "not_started",
  judgment_status: "not_started",
  sentence_status: "not_started",
  appeal_status: "not_started",
  paper_committal_status: "not_commenced",
  information_sworn_status: "not_started",
  summons_served: "unset",
  returns_of_summons: "unset",
  civil_trial_held: "unset",
  decision_granted: null,
  decision_amount: null,
};

/**
 * Walks the protocol's own ordered list. Keep in sync with
 * docket_matters_set_workflow_protocol() in 0140.
 */
export function currentStageForProtocol(
  row: ProtocolSnapshot,
  protocol: WorkflowProtocol,
): ProcedureStage {
  if (protocol === "criminal_trial") {
    return criminalCurrentStage(row);
  }
  if (protocol === "paper_committal") {
    if (row.arraignment_status !== "done") return "arraignment";
    if (row.custody_status === "unset") return "custody";
    if (row.disclosure_status !== "full") return "disclosure";
    if (row.paper_committal_status !== "completed") return "paper_committal";
    if (row.ruling_status !== "delivered") return "ruling";
    if (row.judgment_status !== "delivered") return "judgment";
    return "appeal";
  }
  if (row.information_sworn_status !== "done") return "information_sworn";
  if (row.summons_served !== "yes") return "summons_served";
  if (row.returns_of_summons !== "yes") return "returns_of_summons";
  if (row.civil_trial_held === "unset") return "civil_trial";
  return "decision";
}

export function snapshotFromMatter(matter: {
  arraignment_status?: string | null;
  custody_status?: string | null;
  disclosure_status?: string | null;
  trial_status?: string | null;
  ruling_status?: string | null;
  judgment_status?: string | null;
  sentence_status?: string | null;
  appeal_status?: string | null;
  paper_committal_status?: string | null;
  information_sworn_status?: string | null;
  summons_served?: string | null;
  returns_of_summons?: string | null;
  civil_trial_held?: string | null;
  decision_granted?: string | null;
  decision_amount?: number | string | null;
}): ProtocolSnapshot {
  const amount = matter.decision_amount;
  const parsed =
    amount == null || amount === ""
      ? null
      : typeof amount === "number"
        ? amount
        : Number(amount);
  return {
    arraignment_status: (matter.arraignment_status ?? "not_started") as ArraignmentStatus,
    custody_status: (matter.custody_status ?? "unset") as CustodyStatus,
    disclosure_status: (matter.disclosure_status ?? "none") as DisclosureStatus,
    trial_status: (matter.trial_status ?? "not_commenced") as TrialStatus,
    ruling_status: (matter.ruling_status ?? "not_started") as RulingStatus,
    judgment_status: (matter.judgment_status ?? "not_started") as JudgmentStatus,
    sentence_status: (matter.sentence_status ?? "not_started") as SentenceStatus,
    appeal_status: (matter.appeal_status ?? "not_started") as AppealStatus,
    paper_committal_status: (matter.paper_committal_status ??
      "not_commenced") as PaperCommittalStatus,
    information_sworn_status: (matter.information_sworn_status ??
      "not_started") as InformationSwornStatus,
    summons_served: (matter.summons_served ?? "unset") as YesNoStatus,
    returns_of_summons: (matter.returns_of_summons ?? "unset") as YesNoStatus,
    civil_trial_held: (matter.civil_trial_held ?? "unset") as YesNoStatus,
    decision_granted: (matter.decision_granted as DecisionGrantedStatus | null) ?? null,
    decision_amount: parsed != null && Number.isFinite(parsed) ? parsed : null,
  };
}

export function matterProtocol(matter: {
  workflow_protocol?: string | null;
  category_name?: string | null;
}): WorkflowProtocol {
  if (isWorkflowProtocol(matter.workflow_protocol)) return matter.workflow_protocol;
  return protocolFromCategoryName(matter.category_name);
}

export function matterProtocolStage(matter: {
  workflow_protocol?: string | null;
  category_name?: string | null;
  arraignment_status?: string | null;
  custody_status?: string | null;
  disclosure_status?: string | null;
  trial_status?: string | null;
  ruling_status?: string | null;
  judgment_status?: string | null;
  sentence_status?: string | null;
  appeal_status?: string | null;
  paper_committal_status?: string | null;
  information_sworn_status?: string | null;
  summons_served?: string | null;
  returns_of_summons?: string | null;
  civil_trial_held?: string | null;
  decision_granted?: string | null;
  decision_amount?: number | string | null;
}): ProcedureStage {
  return currentStageForProtocol(snapshotFromMatter(matter), matterProtocol(matter));
}

export function parseStageAdjournments(value: unknown): StageAdjournments {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next: StageAdjournments = {};
  for (const [stage, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as { adjourned?: unknown; reason?: unknown };
    next[stage] = {
      adjourned: entry.adjourned === true,
      reason: typeof entry.reason === "string" ? entry.reason : "",
    };
  }
  return next;
}

export function adjournmentForStage(
  value: unknown,
  stage: ProcedureStage,
): StageAdjournment {
  const parsed = parseStageAdjournments(value);
  return parsed[stage] ?? { adjourned: false, reason: "" };
}

export function mergeStageAdjournment(
  value: unknown,
  stage: ProcedureStage,
  adjourned: boolean,
  reason: string,
): StageAdjournments {
  const parsed = parseStageAdjournments(value);
  if (!adjourned) {
    const rest = { ...parsed };
    delete rest[stage];
    return rest;
  }
  return { ...parsed, [stage]: { adjourned: true, reason: reason.trim() } };
}

export function isProtectionCategory(name: string | null | undefined): boolean {
  return name === PROTECTION_CATEGORY_NAME;
}

export function decisionAmountCaption(categoryName: string | null | undefined): string {
  if (categoryName === LIABILITY_CATEGORY_NAME) return "Amount paid";
  return "Amount ordered";
}

export function decisionDisplayValue(matter: {
  category_name?: string | null;
  decision_granted?: string | null;
  decision_amount?: number | string | null;
}): string {
  if (isProtectionCategory(matter.category_name)) {
    return matter.decision_granted ?? "";
  }
  const amount = matter.decision_amount;
  if (amount == null || amount === "") return "";
  return String(amount);
}

export function boardCellValue(
  row: {
    category_name?: string | null;
    decision_granted?: string | null;
    decision_amount?: number | string | null;
    [key: string]: unknown;
  },
  column: ProcedureColumnKey,
): string {
  if (column === "decision") return decisionDisplayValue(row);
  const meta = BOARD_COLUMNS.find((item) => item.key === column);
  const raw = row[column];
  if (raw == null || raw === "") return meta?.emptyValue ?? "";
  return String(raw);
}

export function boardColumnPatch(
  column: ProcedureColumnKey,
  next: string,
  categoryName: string | null | undefined,
): Record<string, string | number | null> {
  if (column === "decision") {
    if (isProtectionCategory(categoryName)) {
      return { decision_granted: next || null };
    }
    const trimmed = next.trim();
    if (trimmed === "") return { decision_amount: null };
    const amount = Number(trimmed);
    return { decision_amount: Number.isFinite(amount) ? amount : null };
  }
  return { [column]: next };
}

export function outcomeBoardPatch(next: string | null): {
  outcome_status: string | null;
  outcome_adjourned: boolean;
} {
  if (next === "adjourned") {
    return { outcome_status: null, outcome_adjourned: true };
  }
  return { outcome_status: next, outcome_adjourned: false };
}

