import { supabase } from "@/lib/supabase"
import { queryClient } from "@/lib/query-client"
import { useAuthStore } from "@/store/auth-store"
import { toast } from "sonner"
import { syncDocketEventToGoogle } from "@/lib/google-calendar/sync"
import { isGoogleConnected, loadGoogleCalendarState } from "@/lib/google-calendar/storage"
import { flushOutbox } from "@/lib/offline/flush"
import {
  enqueueCreate,
  enqueueGooglePending,
  enqueueUpdate,
  makeLocalEventId,
  type HearingFields,
} from "@/lib/offline/outbox"
import { getOutboxJobs, getProfileCache, setOutboxJobs } from "@/lib/offline/store"
import { hearingFieldsFromEvent } from "@/lib/offline/docket-cache"
import { lockCurrentSession, notifyAuthExpiredSave } from "@/lib/auth/session-lock"

let flushing = false
let sessionToastAt = 0

export const currentProfileId = async (): Promise<string | null> => {
  const fromStore = useAuthStore.getState().user?.id
  if (fromStore) return fromStore
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

const invalidateHearingQueries = () => {
  void queryClient.invalidateQueries({ queryKey: ["docket-events"] })
  void queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
  void queryClient.invalidateQueries({ queryKey: ["dashboard", "upcoming-appearances"] })
}

const liveFlushDeps = () => ({
  insertEvent: async (matterId: string, payload: HearingFields) => {
    const { data, error } = await supabase
      .from("docket_events")
      .insert({ ...payload, docket_matter_id: matterId })
      .select("id")
      .single()
    if (error) throw error
    return { id: data.id }
  },
  updateEvent: async (id: string, payload: HearingFields) => {
    const { error } = await supabase.from("docket_events").update(payload).eq("id", id)
    if (error) throw error
  },
  pushGoogle: async (eventId: string) => {
    try {
      const result = await syncDocketEventToGoogle(eventId)
      if ("skipped" in result && result.skipped) return { synced: true as const, skipped: true as const }
      return { synced: true as const }
    } catch {
      return { synced: false as const }
    }
  },
})

export const enqueueQueuedCreate = async (input: {
  matterId: string
  payload: HearingFields
  caseNumber: string
  matterTitle: string
}) => {
  const profileId = await currentProfileId()
  if (!profileId) throw new Error("You need to be signed in to save a hearing.")
  const id = makeLocalEventId()
  const jobs = enqueueCreate(getOutboxJobs(profileId), {
    kind: "create",
    id,
    matterId: input.matterId,
    payload: input.payload,
    caseNumber: input.caseNumber,
    matterTitle: input.matterTitle,
  })
  await setOutboxJobs(profileId, jobs)
  return id
}

export const enqueueQueuedUpdate = async (input: {
  id: string
  matterId: string
  patch: Partial<HearingFields>
}) => {
  const profileId = await currentProfileId()
  if (!profileId) throw new Error("You need to be signed in to save a hearing.")
  const cache = getProfileCache(profileId)
  const cached = cache.events[input.id]
  const createJob = getOutboxJobs(profileId).find((job) => job.kind === "create" && job.id === input.id)
  const base = createJob && createJob.kind === "create"
    ? createJob.payload
    : cached
      ? hearingFieldsFromEvent(cached)
      : {
          scheduled_date: input.patch.scheduled_date ?? "",
          scheduled_time: input.patch.scheduled_time ?? null,
          event_type: input.patch.event_type ?? null,
          location: input.patch.location ?? null,
          stage_at_event: input.patch.stage_at_event ?? null,
          outcome_at_event: input.patch.outcome_at_event ?? null,
          orders_made_at_event: input.patch.orders_made_at_event ?? null,
          notes: input.patch.notes ?? null,
          event_status: input.patch.event_status ?? "scheduled",
        }
  const matter = cache.matters[input.matterId]
  const jobs = enqueueUpdate(getOutboxJobs(profileId), {
    id: input.id,
    matterId: input.matterId,
    patch: input.patch,
    base,
    caseNumber: matter?.case_number || cached?.case_number || "Matter",
    matterTitle: matter?.matter_title || cached?.matter_title || "Hearing",
  })
  await setOutboxJobs(profileId, jobs)
}

export const enqueueGooglePendingIfNeeded = async (eventId: string, matterId: string) => {
  const state = await loadGoogleCalendarState()
  if (!isGoogleConnected(state)) return
  const profileId = await currentProfileId()
  if (!profileId) return
  const jobs = enqueueGooglePending(getOutboxJobs(profileId), {
    kind: "googlePending",
    id: eventId,
    matterId,
  })
  await setOutboxJobs(profileId, jobs)
}

export const flushPendingHearings = async () => {
  if (flushing) return { skipped: true as const }
  if (useAuthStore.getState().status === "locked") return { skipped: true as const }
  const profileId = await currentProfileId()
  if (!profileId) return { skipped: true as const }
  const jobs = getOutboxJobs(profileId)
  if (jobs.length === 0) return { skipped: true as const }
  flushing = true
  try {
    const result = await flushOutbox(jobs, liveFlushDeps())
    await setOutboxJobs(profileId, result.jobs)
    if (result.insertedIds.length > 0 || result.updatedIds.length > 0) {
      invalidateHearingQueries()
    }
    if (result.authExpired) {
      void lockCurrentSession()
      notifyAuthExpiredSave()
      return result
    }
    if (result.stopped) {
      const expired = Date.now() - sessionToastAt > 30_000
      if (expired) {
        sessionToastAt = Date.now()
        toast.error("Some hearings are still on this device. They will retry when you are back online.")
      }
    }
    return result
  } finally {
    flushing = false
  }
}

export const peekHasDocketWrites = (profileId: string | undefined) => {
  const jobs = getOutboxJobs(profileId)
  return jobs.some((job) => job.kind === "create" || job.kind === "update")
}

let listenersStarted = false

const attachNativeNetworkFlush = async (kick: () => void) => {
  try {
    const native = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    if (!native?.isNativePlatform?.()) return
    const { Network } = await import("@capacitor/network")
    Network.addListener("networkStatusChange", (status) => {
      if (status.connected) kick()
    })
  } catch {
    /* plugin missing until `npx cap sync` */
  }
}

export const startOfflineFlushListeners = () => {
  if (listenersStarted || typeof window === "undefined") return
  listenersStarted = true
  const kick = () => {
    void flushPendingHearings()
  }
  window.addEventListener("online", kick)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kick()
  })
  void attachNativeNetworkFlush(kick)
}

export const syntheticDocketEvent = (
  id: string,
  matterId: string,
  profileId: string,
  payload: HearingFields,
) => {
  const now = new Date().toISOString()
  return {
    id,
    docket_matter_id: matterId,
    ...payload,
    created_at: now,
    created_by: profileId,
    updated_at: now,
    last_updated_by: profileId,
    presiding_magistrate_id: null,
    external_calendar_event_id: null,
    external_calendar_provider: null,
    external_calendar_synced_at: null,
    // Not yet tracked offline (HearingFields predates these columns) —
    // null is the honest "not recorded" default, same as docket-cache.ts.
    category_id: null,
    witnesses_called: null,
    witnesses_completed: null,
    witnesses_partly_heard: null,
    witnesses_remaining: null,
  }
}
