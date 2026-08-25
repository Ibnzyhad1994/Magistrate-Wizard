import { useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { toast } from "sonner"
import type { DocketEvent, TablesInsert, TablesUpdate } from "@/types/database.types"
import { pushAfterLocalSave, syncDocketEventToGoogle } from "@/lib/google-calendar/sync"
import { isQueueableError, MATTER_UNAVAILABLE_OFFLINE } from "@/lib/offline/is-queueable-error"
import {
  currentProfileId,
  enqueueGooglePendingIfNeeded,
  enqueueQueuedCreate,
  enqueueQueuedUpdate,
  syntheticDocketEvent,
} from "@/lib/offline/runtime"
import {
  docketEventFromCached,
  hearingFieldsFromEvent,
  listCachedMatterEvents,
} from "@/lib/offline/docket-cache"
import { mergeMatterEvents } from "@/lib/offline/outbox"
import { getProfileCache } from "@/lib/offline/store"
import { seedMatterEvents } from "@/lib/offline/seed"
import { useOutboxJobs } from "@/hooks/offline/use-pending-hearings"
import { useAuthStore } from "@/store/auth-store"

const key = (matterId: string) => ["docket-events", matterId] as const

const asHearingFields = (values: Omit<TablesInsert<"docket_events">, "docket_matter_id">) =>
  hearingFieldsFromEvent({
    scheduled_date: values.scheduled_date,
    scheduled_time: values.scheduled_time ?? null,
    event_type: values.event_type ?? null,
    location: values.location ?? null,
    stage_at_event: values.stage_at_event ?? null,
    outcome_at_event: values.outcome_at_event ?? null,
    orders_made_at_event: values.orders_made_at_event ?? null,
    notes: values.notes ?? null,
    event_status: values.event_status ?? "scheduled",
  })

const mergeWithOutbox = (
  matterId: string,
  events: DocketEvent[],
  profileId: string | null,
  jobs: ReturnType<typeof useOutboxJobs>,
): DocketEvent[] => {
  const merged = mergeMatterEvents(
    events.map((event) => ({
      id: event.id,
      docket_matter_id: event.docket_matter_id,
      ...hearingFieldsFromEvent(event),
    })),
    jobs,
    matterId,
  )
  const byId = new Map(events.map((event) => [event.id, event]))
  const cache = getProfileCache(profileId ?? undefined)
  return merged.map((row) => {
    const live = byId.get(row.id)
    if (live && !row.pending) return live
    const cached = cache.events[row.id]
    if (cached) {
      return { ...docketEventFromCached(cached), ...hearingFieldsFromEvent(row), id: row.id, docket_matter_id: matterId }
    }
    if (live) return { ...live, ...hearingFieldsFromEvent(row) }
    return syntheticDocketEvent(row.id, matterId, profileId ?? "", hearingFieldsFromEvent(row))
  })
}

/**
 * Docket Events are append-mostly: there is no hard-delete UI action.
 * Mistaken/incorrect events are corrected by editing the record or by
 * setting `event_status` to 'cancelled' / 'entered_in_error' (both live
 * CHECK-constraint values), preserving chronology per the established
 * Docket workflow rules.
 */
export function useDocketEvents(matterId: string | undefined) {
  const jobs = useOutboxJobs()
  const profileId = useAuthStore((state) => state.user?.id ?? null)

  const query = useQuery({
    queryKey: key(matterId ?? ""),
    queryFn: async (): Promise<DocketEvent[]> => {
      const profileId = await currentProfileId()
      try {
        const { data, error } = await supabase
          .from("docket_events")
          .select("*")
          .eq("docket_matter_id", matterId as string)
          .order("scheduled_date", { ascending: false })
          .order("scheduled_time", { ascending: false, nullsFirst: false })
        if (error) throw error
        const rows = data ?? []
        if (profileId && matterId) {
          const cache = getProfileCache(profileId)
          const matter = cache.matters[matterId]
          await seedMatterEvents(
            profileId,
            matterId,
            rows,
            matter?.case_number || "Matter",
            matter?.matter_title || "Hearing",
          )
        }
        return rows
      } catch (error) {
        if (!isQueueableError(error) || !matterId) throw error
        const cache = getProfileCache(profileId ?? undefined)
        if (!cache.matters[matterId]?.opened && !cache.matters[matterId]?.detail) {
          throw new Error(MATTER_UNAVAILABLE_OFFLINE)
        }
        return listCachedMatterEvents(cache, matterId)
      }
    },
    enabled: !!matterId,
    retry: (failureCount, error) => !isQueueableError(error) && failureCount < 1,
  })
  const data = useMemo(() => {
    if (!matterId) return query.data
    return mergeWithOutbox(matterId, query.data ?? [], profileId, jobs)
  }, [matterId, query.data, jobs, profileId])
  return { ...query, data }
}

export function useCreateDocketEvent(matterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: Omit<TablesInsert<"docket_events">, "docket_matter_id">) => {
      try {
        const { data, error } = await supabase
          .from("docket_events")
          .insert({ ...values, docket_matter_id: matterId })
          .select()
          .single()
        if (error) throw error
        return { row: data, queued: false as const }
      } catch (error) {
        if (!isQueueableError(error)) throw error
        const profileId = await currentProfileId()
        const cache = getProfileCache(profileId ?? undefined)
        const matter = cache.matters[matterId]
        const payload = asHearingFields(values)
        const localId = await enqueueQueuedCreate({
          matterId,
          payload,
          caseNumber: matter?.case_number || "Matter",
          matterTitle: matter?.matter_title || "Hearing",
        })
        return {
          row: syntheticDocketEvent(localId, matterId, profileId ?? "", payload),
          queued: true as const,
        }
      }
    },
    onSuccess: (result) => {
      toast.success(result.queued ? "Saved on this device." : "Event added.")
      void queryClient.invalidateQueries({ queryKey: key(matterId) })
      void queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "upcoming-appearances"] })
      if (result.queued) return
      void pushAfterLocalSave(result.row, (saved) => syncDocketEventToGoogle(saved.id)).then((push) => {
        if (!push.synced) {
          void enqueueGooglePendingIfNeeded(result.row.id, matterId)
          toast.error("Saved the hearing, but Google Calendar could not be updated.")
        }
      })
    },
  })
}

export function useUpdateDocketEvent(matterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      values,
    }: {
      id: string
      values: TablesUpdate<"docket_events">
    }) => {
      try {
        const { data, error } = await supabase
          .from("docket_events")
          .update(values)
          .eq("id", id)
          .select()
          .single()
        if (error) throw error
        return { row: data, queued: false as const }
      } catch (error) {
        if (!isQueueableError(error)) throw error
        const patch = {
          ...(values.scheduled_date !== undefined ? { scheduled_date: values.scheduled_date } : {}),
          ...(values.scheduled_time !== undefined ? { scheduled_time: values.scheduled_time } : {}),
          ...(values.event_type !== undefined ? { event_type: values.event_type } : {}),
          ...(values.location !== undefined ? { location: values.location } : {}),
          ...(values.stage_at_event !== undefined ? { stage_at_event: values.stage_at_event } : {}),
          ...(values.outcome_at_event !== undefined ? { outcome_at_event: values.outcome_at_event } : {}),
          ...(values.orders_made_at_event !== undefined
            ? { orders_made_at_event: values.orders_made_at_event }
            : {}),
          ...(values.notes !== undefined ? { notes: values.notes } : {}),
          ...(values.event_status !== undefined ? { event_status: values.event_status } : {}),
        }
        await enqueueQueuedUpdate({ id, matterId, patch })
        const profileId = await currentProfileId()
        const cache = getProfileCache(profileId ?? undefined)
        const cached = cache.events[id]
        if (cached) {
          return {
            row: { ...docketEventFromCached(cached), ...values, id, docket_matter_id: matterId },
            queued: true as const,
          }
        }
        return {
          row: syntheticDocketEvent(
            id,
            matterId,
            profileId ?? "",
            asHearingFields({
              scheduled_date: values.scheduled_date ?? "",
              scheduled_time: values.scheduled_time,
              event_type: values.event_type,
              location: values.location,
              stage_at_event: values.stage_at_event,
              outcome_at_event: values.outcome_at_event,
              orders_made_at_event: values.orders_made_at_event,
              notes: values.notes,
              event_status: values.event_status,
            }),
          ),
          queued: true as const,
        }
      }
    },
    onSuccess: (result) => {
      toast.success(result.queued ? "Saved on this device." : "Event updated.")
      void queryClient.invalidateQueries({ queryKey: key(matterId) })
      void queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "upcoming-appearances"] })
      if (result.queued) return
      void pushAfterLocalSave(result.row, (row) => syncDocketEventToGoogle(row.id)).then((push) => {
        if (!push.synced) {
          void enqueueGooglePendingIfNeeded(result.row.id, matterId)
          toast.error("Saved the hearing, but Google Calendar could not be updated.")
        }
      })
    },
  })
}
