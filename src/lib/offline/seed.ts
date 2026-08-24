import type { DocketEvent } from "@/types/database.types"
import type { CalendarMergeRow } from "@/lib/offline/outbox"
import type { CachedMatterDetail } from "@/lib/offline/docket-cache"
import {
  cachedHearingFromCalendarRow,
  cachedHearingFromDocketEvent,
  upsertHearings,
  upsertMatterAccess,
  upsertMatterShell,
  replaceMatterEvents,
} from "@/lib/offline/docket-cache"
import { getProfileCache, setProfileCache } from "@/lib/offline/store"

export const seedMatterDetail = async (profileId: string, detail: CachedMatterDetail) => {
  const next = upsertMatterShell(getProfileCache(profileId), {
    id: detail.id,
    case_number: detail.case_number,
    matter_title: detail.matter_title,
    detail,
    opened: true,
  })
  await setProfileCache(profileId, next)
}

export const seedMatterEvents = async (
  profileId: string,
  matterId: string,
  events: DocketEvent[],
  caseNumber: string,
  matterTitle: string,
) => {
  let cache = upsertMatterShell(getProfileCache(profileId), {
    id: matterId,
    case_number: caseNumber,
    matter_title: matterTitle,
    opened: true,
  })
  cache = replaceMatterEvents(
    cache,
    matterId,
    events.map((event) => cachedHearingFromDocketEvent(event, caseNumber, matterTitle)),
  )
  await setProfileCache(profileId, cache)
}

export const seedCalendarRows = async (profileId: string, rows: CalendarMergeRow[]) => {
  let cache = getProfileCache(profileId)
  for (const row of rows) {
    cache = upsertMatterShell(cache, {
      id: row.docket_matter_id,
      case_number: row.case_number,
      matter_title: row.matter_title,
    })
  }
  cache = upsertHearings(
    cache,
    rows.map(cachedHearingFromCalendarRow),
  )
  await setProfileCache(profileId, cache)
}

export const seedMatterAccess = async (
  profileId: string,
  matterId: string,
  access: { canEdit: boolean; canManage: boolean },
) => {
  const next = upsertMatterAccess(getProfileCache(profileId), matterId, access)
  await setProfileCache(profileId, next)
}
