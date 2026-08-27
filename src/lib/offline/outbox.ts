export const LOCAL_EVENT_PREFIX = "local:"

export const isLocalEventId = (id: string) => id.startsWith(LOCAL_EVENT_PREFIX)

export const makeLocalEventId = (randomUuid = () => crypto.randomUUID()) =>
  `${LOCAL_EVENT_PREFIX}${randomUuid()}`

export type HearingFields = {
  scheduled_date: string
  scheduled_time: string | null
  event_type: string | null
  location: string | null
  stage_at_event: string | null
  outcome_at_event: string | null
  orders_made_at_event: string | null
  notes: string | null
  event_status: string
}

export type CreateOutboxJob = {
  kind: "create"
  id: string
  matterId: string
  payload: HearingFields
  caseNumber: string
  matterTitle: string
}

export type UpdateOutboxJob = {
  kind: "update"
  id: string
  matterId: string
  payload: HearingFields
  caseNumber: string
  matterTitle: string
}

export type GooglePendingJob = {
  kind: "googlePending"
  id: string
  matterId: string
}

export type OutboxJob = CreateOutboxJob | UpdateOutboxJob | GooglePendingJob

export type CalendarMergeRow = {
  id: string
  docket_matter_id: string
  scheduled_date: string
  scheduled_time: string | null
  location: string | null
  event_type: string | null
  event_status: string
  case_number: string
  matter_title: string
  /** Combined-scope court identifier (0097) — undefined/null for locally
   * queued hearings not yet synced (the outbox job payload doesn't carry
   * it); "Pending" already marks those visually as distinct. */
  court_name?: string | null
  pending?: boolean
}

export const rewriteJobIds = (jobs: OutboxJob[], fromId: string, toId: string): OutboxJob[] =>
  jobs.map((job) => (job.id === fromId ? { ...job, id: toId } : job))

export const hasPendingDocketWrites = (jobs: OutboxJob[]) =>
  jobs.some((job) => job.kind === "create" || job.kind === "update")

export const pendingJobCount = (jobs: OutboxJob[]) => jobs.length

export const pendingEventIds = (jobs: OutboxJob[]) =>
  new Set(jobs.filter((job) => job.kind === "create" || job.kind === "update").map((job) => job.id))

export const enqueueCreate = (
  jobs: OutboxJob[],
  job: CreateOutboxJob,
): OutboxJob[] => [...jobs, job]

export const enqueueUpdate = (
  jobs: OutboxJob[],
  input: {
    id: string
    matterId: string
    patch: Partial<HearingFields>
    base: HearingFields
    caseNumber: string
    matterTitle: string
  },
): OutboxJob[] => {
  const next = jobs.map((job) => ({ ...job }))
  const create = next.find((job): job is CreateOutboxJob => job.kind === "create" && job.id === input.id)
  if (create) {
    create.payload = { ...create.payload, ...input.patch }
    if (input.caseNumber) create.caseNumber = input.caseNumber
    if (input.matterTitle) create.matterTitle = input.matterTitle
    return next
  }
  const update = next.find((job): job is UpdateOutboxJob => job.kind === "update" && job.id === input.id)
  if (update) {
    update.payload = { ...update.payload, ...input.patch }
    if (input.caseNumber) update.caseNumber = input.caseNumber
    if (input.matterTitle) update.matterTitle = input.matterTitle
    return next
  }
  next.push({
    kind: "update",
    id: input.id,
    matterId: input.matterId,
    payload: { ...input.base, ...input.patch },
    caseNumber: input.caseNumber,
    matterTitle: input.matterTitle,
  })
  return next
}

export const enqueueGooglePending = (jobs: OutboxJob[], job: GooglePendingJob): OutboxJob[] => {
  if (jobs.some((item) => item.kind === "googlePending" && item.id === job.id)) return jobs
  if (jobs.some((item) => (item.kind === "create" || item.kind === "update") && item.id === job.id)) {
    return jobs
  }
  return [...jobs, job]
}

export const dropJobById = (jobs: OutboxJob[], id: string, kind?: OutboxJob["kind"]): OutboxJob[] =>
  jobs.filter((job) => !(job.id === id && (kind ? job.kind === kind : true)))

const inRange = (date: string, from: string, to: string) => date >= from && date <= to

export const mergeCalendarRows = (
  rows: CalendarMergeRow[],
  jobs: OutboxJob[],
  from: string,
  to: string,
): CalendarMergeRow[] => {
  const byId = new Map<string, CalendarMergeRow>()
  for (const row of rows) byId.set(row.id, { ...row, pending: false })
  for (const job of jobs) {
    if (job.kind === "googlePending") continue
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
      })
      continue
    }
    const existing = byId.get(job.id)
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
    })
  }
  return [...byId.values()]
    .filter((row) => inRange(row.scheduled_date, from, to))
    .sort((a, b) => {
      if (a.scheduled_date !== b.scheduled_date) return a.scheduled_date.localeCompare(b.scheduled_date)
      return (a.scheduled_time ?? "").localeCompare(b.scheduled_time ?? "")
    })
}

export type MatterEventMergeRow = HearingFields & {
  id: string
  docket_matter_id: string
  pending?: boolean
}

export const mergeMatterEvents = (
  events: MatterEventMergeRow[],
  jobs: OutboxJob[],
  matterId: string,
): MatterEventMergeRow[] => {
  const byId = new Map<string, MatterEventMergeRow>()
  for (const event of events) byId.set(event.id, { ...event, pending: false })
  for (const job of jobs) {
    if (job.matterId !== matterId) continue
    if (job.kind === "googlePending") continue
    const payload = job.payload
    byId.set(job.id, {
      id: job.id,
      docket_matter_id: matterId,
      ...payload,
      pending: true,
    })
  }
  return [...byId.values()].sort((a, b) => {
    if (a.scheduled_date !== b.scheduled_date) return b.scheduled_date.localeCompare(a.scheduled_date)
    return (b.scheduled_time ?? "").localeCompare(a.scheduled_time ?? "")
  })
}
