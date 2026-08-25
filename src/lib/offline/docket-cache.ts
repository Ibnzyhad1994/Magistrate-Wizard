import type { DocketEvent, DocketMatter, Profile } from "@/types/database.types"
import type { CalendarMergeRow, HearingFields } from "@/lib/offline/outbox"

export type CachedMatterDetail = DocketMatter & {
  courts: { id: string; name: string; jurisdiction: string } | null
  magisterial_districts: { id: string; name: string } | null
}

export type CachedHearing = HearingFields & {
  id: string
  docket_matter_id: string
  case_number: string
  matter_title: string
  created_at: string
  created_by: string
  updated_at: string
  last_updated_by: string | null
  presiding_magistrate_id: string | null
  external_calendar_event_id: string | null
  external_calendar_provider: string | null
  external_calendar_synced_at: string | null
}

export type CachedMatter = {
  id: string
  case_number: string
  matter_title: string
  canEdit: boolean | null
  canManage: boolean | null
  detail: CachedMatterDetail | null
  opened: boolean
}

export type ProfileDocketCache = {
  matters: Record<string, CachedMatter>
  events: Record<string, CachedHearing>
}

export const emptyProfileCache = (): ProfileDocketCache => ({
  matters: {},
  events: {},
})

export const hearingFieldsFromEvent = (event: {
  scheduled_date: string
  scheduled_time: string | null
  event_type: string | null
  location: string | null
  stage_at_event: string | null
  outcome_at_event: string | null
  orders_made_at_event: string | null
  notes: string | null
  event_status: string
}): HearingFields => ({
  scheduled_date: event.scheduled_date,
  scheduled_time: event.scheduled_time,
  event_type: event.event_type,
  location: event.location,
  stage_at_event: event.stage_at_event,
  outcome_at_event: event.outcome_at_event,
  orders_made_at_event: event.orders_made_at_event,
  notes: event.notes,
  event_status: event.event_status,
})

export const cachedHearingFromDocketEvent = (
  event: DocketEvent,
  caseNumber: string,
  matterTitle: string,
): CachedHearing => ({
  ...hearingFieldsFromEvent(event),
  id: event.id,
  docket_matter_id: event.docket_matter_id,
  case_number: caseNumber,
  matter_title: matterTitle,
  created_at: event.created_at,
  created_by: event.created_by,
  updated_at: event.updated_at,
  last_updated_by: event.last_updated_by,
  presiding_magistrate_id: event.presiding_magistrate_id,
  external_calendar_event_id: event.external_calendar_event_id,
  external_calendar_provider: event.external_calendar_provider,
  external_calendar_synced_at: event.external_calendar_synced_at,
})

export const cachedHearingFromCalendarRow = (row: CalendarMergeRow): CachedHearing => ({
  id: row.id,
  docket_matter_id: row.docket_matter_id,
  scheduled_date: row.scheduled_date,
  scheduled_time: row.scheduled_time,
  event_type: row.event_type,
  location: row.location,
  event_status: row.event_status,
  stage_at_event: null,
  outcome_at_event: null,
  orders_made_at_event: null,
  notes: null,
  case_number: row.case_number,
  matter_title: row.matter_title,
  created_at: "",
  created_by: "",
  updated_at: "",
  last_updated_by: null,
  presiding_magistrate_id: null,
  external_calendar_event_id: null,
  external_calendar_provider: null,
  external_calendar_synced_at: null,
})

export const docketEventFromCached = (row: CachedHearing): DocketEvent => ({
  id: row.id,
  docket_matter_id: row.docket_matter_id,
  scheduled_date: row.scheduled_date,
  scheduled_time: row.scheduled_time,
  event_type: row.event_type,
  location: row.location,
  event_status: row.event_status,
  stage_at_event: row.stage_at_event,
  outcome_at_event: row.outcome_at_event,
  orders_made_at_event: row.orders_made_at_event,
  notes: row.notes,
  created_at: row.created_at,
  created_by: row.created_by,
  updated_at: row.updated_at,
  last_updated_by: row.last_updated_by,
  presiding_magistrate_id: row.presiding_magistrate_id,
  external_calendar_event_id: row.external_calendar_event_id,
  external_calendar_provider: row.external_calendar_provider,
  external_calendar_synced_at: row.external_calendar_synced_at,
  // Not yet tracked in the offline cache (CachedHearing predates these
  // columns) — null is the honest "not recorded" default, matching how
  // every other not-yet-synced field here is represented.
  category_id: null,
  witnesses_called: null,
  witnesses_completed: null,
  witnesses_partly_heard: null,
  witnesses_remaining: null,
})

export const calendarRowFromCached = (row: CachedHearing): CalendarMergeRow => ({
  id: row.id,
  docket_matter_id: row.docket_matter_id,
  scheduled_date: row.scheduled_date,
  scheduled_time: row.scheduled_time,
  location: row.location,
  event_type: row.event_type,
  event_status: row.event_status,
  case_number: row.case_number,
  matter_title: row.matter_title,
})

export const upsertMatterShell = (
  cache: ProfileDocketCache,
  input: {
    id: string
    case_number: string
    matter_title: string
    detail?: CachedMatterDetail | null
    opened?: boolean
  },
): ProfileDocketCache => {
  const prev = cache.matters[input.id]
  return {
    ...cache,
    matters: {
      ...cache.matters,
      [input.id]: {
        id: input.id,
        case_number: input.case_number,
        matter_title: input.matter_title,
        canEdit: prev?.canEdit ?? null,
        canManage: prev?.canManage ?? null,
        detail: input.detail === undefined ? (prev?.detail ?? null) : input.detail,
        opened: input.opened ?? prev?.opened ?? false,
      },
    },
  }
}

export const upsertMatterAccess = (
  cache: ProfileDocketCache,
  matterId: string,
  access: { canEdit: boolean; canManage: boolean },
): ProfileDocketCache => {
  const prev = cache.matters[matterId]
  if (!prev) {
    return {
      ...cache,
      matters: {
        ...cache.matters,
        [matterId]: {
          id: matterId,
          case_number: "",
          matter_title: "",
          canEdit: access.canEdit,
          canManage: access.canManage,
          detail: null,
          opened: false,
        },
      },
    }
  }
  return {
    ...cache,
    matters: {
      ...cache.matters,
      [matterId]: { ...prev, canEdit: access.canEdit, canManage: access.canManage },
    },
  }
}

export const replaceMatterEvents = (
  cache: ProfileDocketCache,
  matterId: string,
  events: CachedHearing[],
): ProfileDocketCache => {
  const nextEvents = { ...cache.events }
  for (const [id, event] of Object.entries(nextEvents)) {
    if (event.docket_matter_id === matterId) delete nextEvents[id]
  }
  for (const event of events) nextEvents[event.id] = event
  return { ...cache, events: nextEvents }
}

export const upsertHearings = (cache: ProfileDocketCache, events: CachedHearing[]): ProfileDocketCache => {
  const nextEvents = { ...cache.events }
  for (const event of events) nextEvents[event.id] = { ...nextEvents[event.id], ...event }
  return { ...cache, events: nextEvents }
}

export const listCachedHearingsInRange = (
  cache: ProfileDocketCache,
  from: string,
  to: string,
): CalendarMergeRow[] =>
  Object.values(cache.events)
    .filter((event) => event.scheduled_date >= from && event.scheduled_date <= to)
    .map(calendarRowFromCached)

export const listCachedMatterEvents = (cache: ProfileDocketCache, matterId: string): DocketEvent[] =>
  Object.values(cache.events)
    .filter((event) => event.docket_matter_id === matterId)
    .map(docketEventFromCached)

export type CachedProfileMap = Record<string, Profile>
