/**
 * Court-authority matter pack. The docket stays the legal source of truth;
 * this file is a projection for taking a file off-platform or bringing one
 * onto a court the caller currently sits. Matters have no owner_id —
 * authority is sitting court or retained assignment, never a view share.
 */

export const MATTER_PACK_FORMAT = "magistrate-wizard.matter-pack";
export const MATTER_PACK_VERSION = 1;

const STRIP_KEYS = [
  "id",
  "owner_id",
  "court_id",
  "district_id",
  "created_by",
  "created_at",
  "updated_at",
  "last_updated_by",
  "cover_image_path",
  "search_vector",
  "deleted_at",
  "deleted_by",
  "shares",
  "assignments",
  "identification_photo_path",
  "contact_info",
  "presiding_magistrate_id",
  "external_calendar_event_id",
  "external_calendar_provider",
  "external_calendar_synced_at",
] as const;

export type MatterPackParty = {
  full_name: string;
  role: string;
  party_type: string | null;
  party_status: string;
  attorney_name: string | null;
};

export type MatterPackEvent = {
  event_type: string | null;
  scheduled_date: string;
  scheduled_time: string | null;
  location: string | null;
  event_status: string;
  stage_at_event: string | null;
  outcome_at_event: string | null;
  orders_made_at_event: string | null;
  notes: string | null;
};

export type MatterPackMatter = {
  case_number: string;
  matter_title: string;
  charge_or_issue: string | null;
  status: string;
  workflow_protocol: string | null;
  procedure_stage: string | null;
  category_other: string | null;
  arraignment_status: string | null;
  custody_status: string | null;
  disclosure_status: string | null;
  trial_status: string | null;
  paper_committal_status: string | null;
  ruling_status: string | null;
  judgment_status: string | null;
  sentence_status: string | null;
  appeal_status: string | null;
  information_sworn_status: string | null;
  summons_served: string | null;
  returns_of_summons: string | null;
  civil_trial_held: string | null;
  outcome_status: string | null;
  orders_summary: string | null;
  parties: MatterPackParty[];
  events: MatterPackEvent[];
};

export type MatterPackManifest = {
  format: typeof MATTER_PACK_FORMAT;
  version: number;
  exported_at: string;
  include_files: boolean;
  matters: MatterPackMatter[];
};

export type MatterPackParseResult =
  { ok: true; pack: MatterPackManifest } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown) => (typeof value === "string" ? value : null);

const requiredString = (value: unknown) => {
  const text = asString(value)?.trim();
  return text ? text : null;
};

export const matterIsExportable = (args: {
  matterId: string;
  courtId: string;
  sittingCourtIds: Iterable<string>;
  retainedMatterIds: Iterable<string>;
}) => {
  const sitting = new Set(args.sittingCourtIds);
  const retained = new Set(args.retainedMatterIds);
  return sitting.has(args.courtId) || retained.has(args.matterId);
};

export const stripForbiddenKeys = (value: Record<string, unknown>) => {
  const next: Record<string, unknown> = { ...value };
  for (const key of STRIP_KEYS) delete next[key];
  return next;
};

const sanitizeParty = (value: unknown): MatterPackParty | null => {
  if (!isRecord(value)) return null;
  const cleaned = stripForbiddenKeys(value);
  const full_name = requiredString(cleaned.full_name);
  const role = requiredString(cleaned.role);
  if (!full_name || !role) return null;
  return {
    full_name,
    role,
    party_type: asString(cleaned.party_type),
    party_status: asString(cleaned.party_status) ?? "active",
    attorney_name: asString(cleaned.attorney_name),
  };
};

const sanitizeEvent = (value: unknown): MatterPackEvent | null => {
  if (!isRecord(value)) return null;
  const cleaned = stripForbiddenKeys(value);
  const scheduled_date = requiredString(cleaned.scheduled_date);
  if (!scheduled_date || !/^\d{4}-\d{2}-\d{2}$/.test(scheduled_date)) return null;
  return {
    event_type: asString(cleaned.event_type),
    scheduled_date,
    scheduled_time: asString(cleaned.scheduled_time),
    location: asString(cleaned.location),
    event_status: asString(cleaned.event_status) ?? "scheduled",
    stage_at_event: asString(cleaned.stage_at_event),
    outcome_at_event: asString(cleaned.outcome_at_event),
    orders_made_at_event: asString(cleaned.orders_made_at_event),
    notes: asString(cleaned.notes),
  };
};

export const sanitizeMatterForPack = (value: unknown): MatterPackMatter | null => {
  if (!isRecord(value)) return null;
  const cleaned = stripForbiddenKeys(value);
  const case_number = requiredString(cleaned.case_number);
  const matter_title = requiredString(cleaned.matter_title);
  if (!case_number || !matter_title) return null;
  const parties = Array.isArray(cleaned.parties)
    ? cleaned.parties.map(sanitizeParty).filter((row): row is MatterPackParty => Boolean(row))
    : [];
  const events = Array.isArray(cleaned.events)
    ? cleaned.events.map(sanitizeEvent).filter((row): row is MatterPackEvent => Boolean(row))
    : [];
  return {
    case_number,
    matter_title,
    charge_or_issue: asString(cleaned.charge_or_issue),
    status: asString(cleaned.status) ?? "active",
    workflow_protocol: asString(cleaned.workflow_protocol),
    procedure_stage: asString(cleaned.procedure_stage),
    category_other: asString(cleaned.category_other),
    arraignment_status: asString(cleaned.arraignment_status),
    custody_status: asString(cleaned.custody_status),
    disclosure_status: asString(cleaned.disclosure_status),
    trial_status: asString(cleaned.trial_status),
    paper_committal_status: asString(cleaned.paper_committal_status),
    ruling_status: asString(cleaned.ruling_status),
    judgment_status: asString(cleaned.judgment_status),
    sentence_status: asString(cleaned.sentence_status),
    appeal_status: asString(cleaned.appeal_status),
    information_sworn_status: asString(cleaned.information_sworn_status),
    summons_served: asString(cleaned.summons_served),
    returns_of_summons: asString(cleaned.returns_of_summons),
    civil_trial_held: asString(cleaned.civil_trial_held),
    outcome_status: asString(cleaned.outcome_status),
    orders_summary: asString(cleaned.orders_summary),
    parties,
    events,
  };
};

export const parseMatterPack = (value: unknown): MatterPackParseResult => {
  if (!isRecord(value)) return { ok: false, error: "That file is not a matter pack." };
  if (value.format !== MATTER_PACK_FORMAT) {
    return { ok: false, error: "Unknown pack format. Export a Magistrate Wizard matter pack." };
  }
  if (value.version !== MATTER_PACK_VERSION) {
    return { ok: false, error: "This pack version is not supported." };
  }
  if (!Array.isArray(value.matters) || value.matters.length === 0) {
    return { ok: false, error: "The pack does not contain any matters." };
  }
  const matters = value.matters
    .map(sanitizeMatterForPack)
    .filter((row): row is MatterPackMatter => Boolean(row));
  if (matters.length === 0) {
    return { ok: false, error: "None of the matters in that pack could be read." };
  }
  return {
    ok: true,
    pack: {
      format: MATTER_PACK_FORMAT,
      version: MATTER_PACK_VERSION,
      exported_at: asString(value.exported_at) ?? new Date().toISOString(),
      include_files: value.include_files === true,
      matters,
    },
  };
};

export type MatterInsertProjection = {
  case_number: string;
  matter_title: string;
  charge_or_issue: string | null;
  status: "active" | "stayed" | "completed" | "archived" | "dismissed";
  court_id: string;
  district_id: string;
  workflow_protocol?: string;
  procedure_stage?: string;
  arraignment_status?: string;
  custody_status?: string;
  disclosure_status?: string;
  trial_status?: string;
  paper_committal_status?: string;
  ruling_status?: string;
  judgment_status?: string;
  sentence_status?: string;
  appeal_status?: string;
  information_sworn_status?: string;
  summons_served?: string;
  returns_of_summons?: string;
  civil_trial_held?: string;
  outcome_status?: string;
  orders_summary?: string | null;
  category_other?: string | null;
};

const STATUSES = new Set(["active", "stayed", "completed", "archived", "dismissed"]);

export const projectMatterInsert = (
  matter: MatterPackMatter,
  courtId: string,
  districtId: string,
): MatterInsertProjection => {
  const status = STATUSES.has(matter.status)
    ? (matter.status as MatterInsertProjection["status"])
    : "active";
  return {
    case_number: matter.case_number,
    matter_title: matter.matter_title,
    charge_or_issue: matter.charge_or_issue,
    status,
    court_id: courtId,
    district_id: districtId,
    workflow_protocol: matter.workflow_protocol ?? undefined,
    procedure_stage: matter.procedure_stage ?? undefined,
    arraignment_status: matter.arraignment_status ?? undefined,
    custody_status: matter.custody_status ?? undefined,
    disclosure_status: matter.disclosure_status ?? undefined,
    trial_status: matter.trial_status ?? undefined,
    paper_committal_status: matter.paper_committal_status ?? undefined,
    ruling_status: matter.ruling_status ?? undefined,
    judgment_status: matter.judgment_status ?? undefined,
    sentence_status: matter.sentence_status ?? undefined,
    appeal_status: matter.appeal_status ?? undefined,
    information_sworn_status: matter.information_sworn_status ?? undefined,
    summons_served: matter.summons_served ?? undefined,
    returns_of_summons: matter.returns_of_summons ?? undefined,
    civil_trial_held: matter.civil_trial_held ?? undefined,
    outcome_status: matter.outcome_status ?? undefined,
    orders_summary: matter.orders_summary,
    category_other: matter.category_other,
  };
};

export const importJacketValues = (
  matter: MatterPackMatter,
  courtId: string,
  districtId: string,
): Pick<
  MatterInsertProjection,
  "case_number" | "matter_title" | "charge_or_issue" | "status" | "court_id" | "district_id"
> => {
  const projected = projectMatterInsert(matter, courtId, districtId);
  return {
    case_number: projected.case_number,
    matter_title: projected.matter_title,
    charge_or_issue: projected.charge_or_issue,
    status: projected.status,
    court_id: projected.court_id,
    district_id: projected.district_id,
  };
};

export const duplicateCaseNumbers = (
  incoming: Array<{ case_number: string }>,
  existing: Array<{ case_number: string; court_id: string }>,
  targetCourtId: string,
) => {
  const onCourt = new Set(
    existing
      .filter((row) => row.court_id === targetCourtId)
      .map((row) => row.case_number.toLowerCase()),
  );
  return incoming
    .filter((row) => onCourt.has(row.case_number.toLowerCase()))
    .map((row) => row.case_number);
};
