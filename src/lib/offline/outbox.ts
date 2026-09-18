import type { TablesUpdate } from "@/types";

export const LOCAL_EVENT_PREFIX = "local:";

export const isLocalEventId = (id: string) => id.startsWith(LOCAL_EVENT_PREFIX);

export const makeLocalEventId = (randomUuid = () => crypto.randomUUID()) =>
  `${LOCAL_EVENT_PREFIX}${randomUuid()}`;

export type HearingFields = {
  scheduled_date: string;
  scheduled_time: string | null;
  event_type: string | null;
  location: string | null;
  stage_at_event: string | null;
  outcome_at_event: string | null;
  orders_made_at_event: string | null;
  notes: string | null;
  event_status: string;
};

/**
 * How many times a job may fail on an error the classifier does not
 * recognise before it is dead-lettered instead of retried. Without a
 * bound, one such job stops the whole drain on every reconnect and every
 * job behind it stays queued indefinitely.
 */
export const MAX_UNCLASSIFIED_ATTEMPTS = 5;

export type CreateOutboxJob = {
  kind: "create";
  id: string;
  matterId: string;
  payload: HearingFields;
  caseNumber: string;
  matterTitle: string;
  /** Failed replays on an unrecognised error. Absent until the first one. */
  attempts?: number;
};

export type UpdateOutboxJob = {
  kind: "update";
  id: string;
  matterId: string;
  payload: HearingFields;
  caseNumber: string;
  matterTitle: string;
  /**
   * The row's `updated_at` as last seen on this device when the first
   * offline edit was queued. Replay guards the UPDATE with it so a change
   * made elsewhere in the meantime is reported as a conflict rather than
   * overwritten (last-write-wins was the previous behaviour). Absent for
   * jobs queued before this field existed, or when nothing was cached.
   */
  baseUpdatedAt?: string | null;
  /** Failed replays on an unrecognised error. Absent until the first one. */
  attempts?: number;
};

/**
 * A queued change to the matter row itself: the procedure board cells and
 * the Outcome column. One job per matter, not one per tap — board cells
 * are absolute values rather than deltas, so replaying the intermediate
 * states of a magistrate changing their mind buys nothing and would force
 * dropping the updated_at guard for every write after the first.
 *
 * The id is prefixed because `rewriteJobIds` and `discardFailedJob` match
 * on a bare id, and a raw matter id could otherwise collide with a
 * rewritten event id.
 */
export type MatterPatchJob = {
  kind: "matterPatch";
  /** `matter:<matterId>` */
  id: string;
  matterId: string;
  /** Column -> value. Later taps overwrite earlier ones for the same column. */
  patch: TablesUpdate<"docket_matters">;
  /**
   * The row's `updated_at` as first seen on this device. Kept from the
   * FIRST queued change, for the same reason enqueueUpdate keeps the
   * first payload snapshot: that is the version the person actually saw.
   */
  baseUpdatedAt?: string | null;
  caseNumber: string;
  matterTitle: string;
  /** Columns touched, in order, for the banner's "what was lost" copy. */
  columns: string[];
  attempts?: number;
};

export type GooglePendingJob = {
  kind: "googlePending";
  id: string;
  matterId: string;
};

export type OutboxJob = CreateOutboxJob | UpdateOutboxJob | MatterPatchJob | GooglePendingJob;

/** The id a matter's queued board changes are coalesced under. */
export const matterPatchJobId = (matterId: string) => `matter:${matterId}`;

/**
 * A queued write the flush gave up on. `dropped` = the server refused it
 * (permission or validation), `conflict` = the hearing changed elsewhere
 * after it was edited offline. Kept until the user discards it.
 */
export type FailedOutboxJob = {
  job: CreateOutboxJob | UpdateOutboxJob | MatterPatchJob;
  /**
   * `dropped` = the server refused it, `conflict` = the hearing changed
   * elsewhere, `stalled` = it kept failing on an error we cannot classify,
   * so it was set aside rather than left blocking the queue.
   */
  reason: "dropped" | "conflict" | "stalled";
  message: string;
  failedAt: string;
};

export type CalendarMergeRow = {
  id: string;
  docket_matter_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  location: string | null;
  event_type: string | null;
  event_status: string;
  case_number: string;
  matter_title: string;
  /** Combined-scope court identifier (0097) — undefined/null for locally
   * queued hearings not yet synced (the outbox job payload doesn't carry
   * it); "Pending" already marks those visually as distinct. */
  court_name?: string | null;
  pending?: boolean;
};

export const rewriteJobIds = (jobs: OutboxJob[], fromId: string, toId: string): OutboxJob[] =>
  jobs.map((job) => (job.id === fromId ? { ...job, id: toId } : job));

export const hasPendingDocketWrites = (jobs: OutboxJob[]) =>
  jobs.some((job) => job.kind === "create" || job.kind === "update" || job.kind === "matterPatch");

export const pendingJobCount = (jobs: OutboxJob[]) => jobs.length;

export const pendingEventIds = (jobs: OutboxJob[]) =>
  new Set(
    jobs.filter((job) => job.kind === "create" || job.kind === "update").map((job) => job.id),
  );

export const enqueueCreate = (jobs: OutboxJob[], job: CreateOutboxJob): OutboxJob[] => [
  ...jobs,
  job,
];

export const enqueueUpdate = (
  jobs: OutboxJob[],
  input: {
    id: string;
    matterId: string;
    patch: Partial<HearingFields>;
    base: HearingFields;
    caseNumber: string;
    matterTitle: string;
    baseUpdatedAt?: string | null;
  },
): OutboxJob[] => {
  const next = jobs.map((job) => ({ ...job }));
  const create = next.find(
    (job): job is CreateOutboxJob => job.kind === "create" && job.id === input.id,
  );
  if (create) {
    create.payload = { ...create.payload, ...input.patch };
    if (input.caseNumber) create.caseNumber = input.caseNumber;
    if (input.matterTitle) create.matterTitle = input.matterTitle;
    return next;
  }
  const update = next.find(
    (job): job is UpdateOutboxJob => job.kind === "update" && job.id === input.id,
  );
  if (update) {
    update.payload = { ...update.payload, ...input.patch };
    if (input.caseNumber) update.caseNumber = input.caseNumber;
    if (input.matterTitle) update.matterTitle = input.matterTitle;
    return next;
  }
  next.push({
    kind: "update",
    id: input.id,
    matterId: input.matterId,
    payload: { ...input.base, ...input.patch },
    caseNumber: input.caseNumber,
    matterTitle: input.matterTitle,
    // A later edit to the same queued job keeps the FIRST snapshot above:
    // that is the version the person actually saw before editing.
    baseUpdatedAt: input.baseUpdatedAt ?? null,
  });
  return next;
};

/**
 * Adds a board change to this matter's queued job, creating it on the
 * first change. Last write per column wins; the first `baseUpdatedAt` is
 * retained so one row-version check covers the whole coalesced job and
 * the magistrate gets one conflict decision rather than several.
 */
export const enqueueMatterPatch = (
  jobs: OutboxJob[],
  input: {
    matterId: string;
    patch: TablesUpdate<"docket_matters">;
    caseNumber: string;
    matterTitle: string;
    baseUpdatedAt?: string | null;
  },
): OutboxJob[] => {
  const id = matterPatchJobId(input.matterId);
  const columns = Object.keys(input.patch);
  const existing = jobs.find(
    (job): job is MatterPatchJob => job.kind === "matterPatch" && job.id === id,
  );
  if (!existing) {
    return [
      ...jobs,
      {
        kind: "matterPatch",
        id,
        matterId: input.matterId,
        patch: { ...input.patch },
        baseUpdatedAt: input.baseUpdatedAt ?? null,
        caseNumber: input.caseNumber,
        matterTitle: input.matterTitle,
        columns,
      },
    ];
  }
  return jobs.map((job) =>
    job.kind === "matterPatch" && job.id === id
      ? {
          ...job,
          patch: { ...job.patch, ...input.patch },
          // baseUpdatedAt deliberately NOT refreshed -- see the type.
          caseNumber: input.caseNumber || job.caseNumber,
          matterTitle: input.matterTitle || job.matterTitle,
          columns: [...job.columns.filter((c) => !columns.includes(c)), ...columns],
        }
      : job,
  );
};

/** Matters with queued board changes, for marking their row as pending. */
export const pendingMatterIds = (jobs: OutboxJob[]) =>
  new Set(
    jobs.filter((job): job is MatterPatchJob => job.kind === "matterPatch").map((j) => j.matterId),
  );

/** The queued board change for one matter, if any. */
export const pendingMatterPatch = (jobs: OutboxJob[], matterId: string) =>
  jobs.find(
    (job): job is MatterPatchJob => job.kind === "matterPatch" && job.matterId === matterId,
  ) ?? null;

export const enqueueGooglePending = (jobs: OutboxJob[], job: GooglePendingJob): OutboxJob[] => {
  if (jobs.some((item) => item.kind === "googlePending" && item.id === job.id)) return jobs;
  if (
    jobs.some((item) => (item.kind === "create" || item.kind === "update") && item.id === job.id)
  ) {
    return jobs;
  }
  return [...jobs, job];
};

export const dropJobById = (jobs: OutboxJob[], id: string, kind?: OutboxJob["kind"]): OutboxJob[] =>
  jobs.filter((job) => !(job.id === id && (kind ? job.kind === kind : true)));

const inRange = (date: string, from: string, to: string) => date >= from && date <= to;

export const mergeCalendarRows = (
  rows: CalendarMergeRow[],
  jobs: OutboxJob[],
  from: string,
  to: string,
): CalendarMergeRow[] => {
  const byId = new Map<string, CalendarMergeRow>();
  for (const row of rows) byId.set(row.id, { ...row, pending: false });
  for (const job of jobs) {
    // Only hearings appear on a calendar; a queued board change is not an
    // appearance and must not invent one.
    if (job.kind === "googlePending" || job.kind === "matterPatch") continue;
    if (job.kind === "create") {
      byId.set(job.id, {
        id: job.id,
        docket_matter_id: job.matterId,
        scheduled_date: job.payload.scheduled_date,
        scheduled_time: job.payload.scheduled_time,
        location: job.payload.location,
        event_type: job.payload.event_type,
        event_status: job.payload.event_status,
        case_number: job.caseNumber,
        matter_title: job.matterTitle,
        court_name: null,
        pending: true,
      });
      continue;
    }
    const existing = byId.get(job.id);
    byId.set(job.id, {
      id: job.id,
      docket_matter_id: job.matterId,
      scheduled_date: job.payload.scheduled_date,
      scheduled_time: job.payload.scheduled_time,
      location: job.payload.location,
      event_type: job.payload.event_type,
      event_status: job.payload.event_status,
      case_number: job.caseNumber || existing?.case_number || "Matter",
      matter_title: job.matterTitle || existing?.matter_title || "Hearing",
      court_name: existing?.court_name ?? null,
      pending: true,
    });
  }
  return [...byId.values()]
    .filter((row) => inRange(row.scheduled_date, from, to))
    .sort((a, b) => {
      if (a.scheduled_date !== b.scheduled_date)
        return a.scheduled_date.localeCompare(b.scheduled_date);
      return (a.scheduled_time ?? "").localeCompare(b.scheduled_time ?? "");
    });
};

export type MatterEventMergeRow = HearingFields & {
  id: string;
  docket_matter_id: string;
  pending?: boolean;
};

export const mergeMatterEvents = (
  events: MatterEventMergeRow[],
  jobs: OutboxJob[],
  matterId: string,
): MatterEventMergeRow[] => {
  const byId = new Map<string, MatterEventMergeRow>();
  for (const event of events) byId.set(event.id, { ...event, pending: false });
  for (const job of jobs) {
    if (job.matterId !== matterId) continue;
    if (job.kind === "googlePending" || job.kind === "matterPatch") continue;
    const payload = job.payload;
    byId.set(job.id, {
      id: job.id,
      docket_matter_id: matterId,
      ...payload,
      pending: true,
    });
  }
  return [...byId.values()].sort((a, b) => {
    if (a.scheduled_date !== b.scheduled_date)
      return b.scheduled_date.localeCompare(a.scheduled_date);
    return (b.scheduled_time ?? "").localeCompare(a.scheduled_time ?? "");
  });
};

/**
 * One-line description of a dead-lettered job, as data rather than JSX,
 * so the banner does not grow a branch per job kind and this can be
 * asserted from a plain Node test.
 */
export const describeFailedJob = (item: FailedOutboxJob): { title: string; detail: string } => {
  const who = `${item.job.caseNumber} · ${item.job.matterTitle}`;
  if (item.job.kind === "matterPatch") {
    const columns = item.job.columns.map(columnLabel).join(", ");
    return {
      title: `${who} — ${columns || "board change"}`,
      detail: item.message,
    };
  }
  const what = item.job.kind === "create" ? "new hearing" : "hearing change";
  return {
    title: `${who} — ${what} for ${item.job.payload.scheduled_date}`,
    detail: item.message,
  };
};

/** `trial_status` -> `Trial`. Good enough for a failure line; the board owns the real labels. */
const columnLabel = (column: string) =>
  column
    .replace(/_status$/, "")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
