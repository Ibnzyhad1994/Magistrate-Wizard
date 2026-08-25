import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { isQueueableError } from "@/lib/offline/is-queueable-error"
import { mergeCalendarRows, type CalendarMergeRow } from "@/lib/offline/outbox"
import { currentProfileId } from "@/lib/offline/runtime"
import { getProfileCache } from "@/lib/offline/store"
import { listCachedHearingsInRange } from "@/lib/offline/docket-cache"
import { seedCalendarRows } from "@/lib/offline/seed"
import { useOutboxJobs } from "@/hooks/offline/use-pending-hearings"

export type CalendarEventRow = CalendarMergeRow

const asMatter = (value: unknown): { case_number: string; matter_title: string } | null => {
  if (!value || typeof value !== "object") return null
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== "object") return null
  const rec = row as { case_number?: string; matter_title?: string }
  if (!rec.case_number || !rec.matter_title) return null
  return { case_number: rec.case_number, matter_title: rec.matter_title }
}

export const calendarEventsKey = (from: string, to: string) =>
  ["calendar-events", from, to] as const

/**
 * Docket events the caller can already SELECT. RLS
 * (`can_view_docket_matter`) is the only access filter.
 */
export function useCalendarEvents(from: string, to: string) {
  const query = useQuery({
    queryKey: calendarEventsKey(from, to),
    queryFn: async (): Promise<CalendarEventRow[]> => {
      const profileId = await currentProfileId()
      try {
        const { data, error } = await supabase
          .from("docket_events")
          .select(
            "id, docket_matter_id, scheduled_date, scheduled_time, location, event_type, event_status, docket_matters(case_number, matter_title)",
          )
          .gte("scheduled_date", from)
          .lte("scheduled_date", to)
          .order("scheduled_date", { ascending: true })
          .order("scheduled_time", { ascending: true, nullsFirst: true })
        if (error) throw error
        const rows = (data ?? []).map((row) => {
          const matter = asMatter(row.docket_matters)
          return {
            id: row.id,
            docket_matter_id: row.docket_matter_id,
            scheduled_date: row.scheduled_date,
            scheduled_time: row.scheduled_time,
            location: row.location,
            event_type: row.event_type,
            event_status: row.event_status,
            case_number: matter?.case_number ?? "Matter",
            matter_title: matter?.matter_title ?? "Hearing",
          }
        })
        if (profileId) await seedCalendarRows(profileId, rows)
        return rows
      } catch (error) {
        if (!isQueueableError(error)) throw error
        return listCachedHearingsInRange(getProfileCache(profileId ?? undefined), from, to)
      }
    },
    retry: (failureCount, error) => !isQueueableError(error) && failureCount < 1,
  })
  const jobs = useOutboxJobs()
  const data = useMemo(
    () => mergeCalendarRows(query.data ?? [], jobs, from, to),
    [query.data, jobs, from, to],
  )
  return { ...query, data }
}
