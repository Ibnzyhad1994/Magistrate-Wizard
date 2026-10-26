import type { TablesUpdate } from "@/types";
import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";
import { useAuthStore } from "@/store/auth-store";
import { toast } from "sonner";
import { syncDocketEventToGoogle } from "@/lib/google-calendar/sync";
import { isGoogleConnected, loadGoogleCalendarState } from "@/lib/google-calendar/storage";
import { flushOutbox } from "@/lib/offline/flush";
import { createAutoSync } from "@/lib/offline/auto-sync";
import { isKnownOffline } from "@/lib/offline/is-queueable-error";
import {
  enqueueCreate,
  enqueueMatterPatch,
  type OutboxJob,
  enqueueNextDate,
  enqueueGooglePending,
  enqueueUpdate,
  makeLocalEventId,
  type HearingFields,
} from "@/lib/offline/outbox";
import {
  appendFailedJobs,
  discardFailedJob,
  getFailedJobs,
  getOutboxJobs,
  getProfileCache,
  offlineWipeCount,
  setOutboxJobs,
  subscribeOfflineStore,
} from "@/lib/offline/store";
import { hearingFieldsFromEvent } from "@/lib/offline/docket-cache";
import { lockCurrentSession, notifyAuthExpiredSave } from "@/lib/auth/session-lock";
import {
  flushQueuedJudgmentDrafts,
  getJudgmentDraftSummary,
  refreshJudgmentDraftSummary,
  subscribeJudgmentDrafts,
} from "@/lib/offline/judgment-drafts-runtime";

let flushing = false;
let sessionToastAt = 0;

export const currentProfileId = async (): Promise<string | null> => {
  const fromStore = useAuthStore.getState().user?.id;
  if (fromStore) return fromStore;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
};

const invalidateHearingQueries = () => {
  void queryClient.invalidateQueries({ queryKey: ["docket-events"] });
  void queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard", "upcoming-appearances"] });
};

const liveFlushDeps = () => ({
  insertEvent: async (matterId: string, payload: HearingFields) => {
    const { data, error } = await supabase
      .from("docket_events")
      .insert({ ...payload, docket_matter_id: matterId })
      .select("id")
      .single();
    if (error) throw error;
    return { id: data.id };
  },
  updateEvent: async (id: string, payload: HearingFields, baseUpdatedAt?: string | null) => {
    // Same optimistic guard docket matters already use: the UPDATE only
    // matches while the row still carries the updated_at this device saw.
    // Zero rows = changed elsewhere (or no longer visible) = conflict, not
    // a silent overwrite.
    let query = supabase.from("docket_events").update(payload).eq("id", id);
    if (baseUpdatedAt) query = query.eq("updated_at", baseUpdatedAt);
    const { data, error } = await query.select("id");
    if (error) throw error;
    if ((data ?? []).length === 0) return { conflict: true };
  },
  /**
   * Same guarded UPDATE the online board uses. A zero-row match means the
   * file changed elsewhere (or is no longer visible), which is a conflict
   * to report, never a silent overwrite.
   */
  setNextDate: async (matterId: string, scheduledDate: string, categoryId: string | null) => {
    const { data, error } = await supabase.rpc("set_docket_matter_next_date", {
      p_docket_matter_id: matterId,
      p_scheduled_date: scheduledDate,
      p_category_id: categoryId ?? undefined,
      // Never acknowledged on replay -- see the flush's capacity branch.
      p_acknowledge_override: false,
    });
    if (error) throw error;
    return { status: data?.[0]?.status ?? "created" };
  },
  patchMatter: async (
    matterId: string,
    patch: TablesUpdate<"docket_matters">,
    baseUpdatedAt?: string | null,
  ) => {
    let query = supabase.from("docket_matters").update(patch).eq("id", matterId);
    if (baseUpdatedAt) query = query.eq("updated_at", baseUpdatedAt);
    const { data, error } = await query.select("id");
    if (error) throw error;
    if ((data ?? []).length === 0) return { conflict: true };
  },
  pushGoogle: async (eventId: string) => {
    try {
      const result = await syncDocketEventToGoogle(eventId);
      if ("skipped" in result && result.skipped)
        return { synced: true as const, skipped: true as const };
      return { synced: true as const };
    } catch {
      return { synced: false as const };
    }
  },
});

export const enqueueQueuedCreate = async (input: {
  matterId: string;
  payload: HearingFields;
  caseNumber: string;
  matterTitle: string;
}) => {
  const profileId = await currentProfileId();
  if (!profileId) throw new Error("You need to be signed in to save a hearing.");
  const id = makeLocalEventId();
  const jobs = enqueueCreate(getOutboxJobs(profileId), {
    kind: "create",
    id,
    matterId: input.matterId,
    payload: input.payload,
    caseNumber: input.caseNumber,
    matterTitle: input.matterTitle,
  });
  await setOutboxJobs(profileId, jobs);
  return id;
};

/**
 * Queues a board change for one matter, coalescing it with anything
 * already queued for that file. Returns nothing: the caller has already
 * painted the new value optimistically and must not roll it back.
 */
export const enqueueQueuedMatterPatch = async (input: {
  matterId: string;
  patch: TablesUpdate<"docket_matters">;
  caseNumber: string;
  matterTitle: string;
  baseUpdatedAt?: string | null;
}) => {
  const profileId = await currentProfileId();
  if (!profileId) throw new Error("You need to be signed in to save a change.");
  const jobs = enqueueMatterPatch(getOutboxJobs(profileId), input);
  await setOutboxJobs(profileId, jobs);
};

/** Queues a next date for one matter, replacing anything already queued. */
export const enqueueQueuedNextDate = async (input: {
  matterId: string;
  scheduledDate: string;
  categoryId: string | null;
  caseNumber: string;
  matterTitle: string;
}) => {
  const profileId = await currentProfileId();
  if (!profileId) throw new Error("You need to be signed in to set a next date.");
  await setOutboxJobs(profileId, enqueueNextDate(getOutboxJobs(profileId), input));
};

export const enqueueQueuedUpdate = async (input: {
  id: string;
  matterId: string;
  patch: Partial<HearingFields>;
}) => {
  const profileId = await currentProfileId();
  if (!profileId) throw new Error("You need to be signed in to save a hearing.");
  const cache = getProfileCache(profileId);
  const cached = cache.events[input.id];
  const createJob = getOutboxJobs(profileId).find(
    (job) => job.kind === "create" && job.id === input.id,
  );
  const base =
    createJob && createJob.kind === "create"
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
          };
  const matter = cache.matters[input.matterId];
  const jobs = enqueueUpdate(getOutboxJobs(profileId), {
    id: input.id,
    matterId: input.matterId,
    patch: input.patch,
    base,
    caseNumber: matter?.case_number || cached?.case_number || "Matter",
    matterTitle: matter?.matter_title || cached?.matter_title || "Hearing",
    baseUpdatedAt: createJob ? null : cached?.updated_at || null,
  });
  await setOutboxJobs(profileId, jobs);
};

/** Drop one entry from the persisted failed list (the user chose to discard it). */
export const discardFailedHearing = async (jobId: string) => {
  const profileId = await currentProfileId();
  if (!profileId) return;
  await discardFailedJob(profileId, jobId);
};

/**
 * Re-queues a job that was dead-lettered as a CONFLICT, deliberately
 * without its row-version guard so it will overwrite what is there now.
 *
 * Offered only for conflicts, and only as an explicit choice: the person
 * has been shown what changed and what they would replace. It is not an
 * automatic retry and it is never offered for a refusal, which will not
 * resolve by trying again. RLS still decides -- dropping the guard
 * removes an optimistic-concurrency check, not an access check.
 */
export const reapplyFailedJob = async (jobId: string) => {
  const profileId = await currentProfileId();
  if (!profileId) return;
  const entry = getFailedJobs(profileId).find((item) => item.job.id === jobId);
  if (!entry || entry.reason !== "conflict") return;
  const job = { ...entry.job, baseUpdatedAt: null, attempts: 0 } as OutboxJob;
  await setOutboxJobs(profileId, [...getOutboxJobs(profileId), job]);
  await discardFailedJob(profileId, jobId);
  await syncOfflineWorkNow();
};

export const enqueueGooglePendingIfNeeded = async (eventId: string, matterId: string) => {
  const state = await loadGoogleCalendarState();
  if (!isGoogleConnected(state)) return;
  const profileId = await currentProfileId();
  if (!profileId) return;
  const jobs = enqueueGooglePending(getOutboxJobs(profileId), {
    kind: "googlePending",
    id: eventId,
    matterId,
  });
  await setOutboxJobs(profileId, jobs);
};

/**
 * `background` is the automatic backoff retry (see auto-sync.ts): a failure
 * then keeps the job's attempt count and stays quiet, because the sync
 * banner already says the work is waiting and a toast every retry would
 * only be noise.
 */
export const flushPendingHearings = async ({ background = false } = {}) => {
  if (flushing) return { skipped: true as const };
  if (useAuthStore.getState().status === "locked") return { skipped: true as const };
  const profileId = await currentProfileId();
  if (!profileId) return { skipped: true as const };
  const jobs = getOutboxJobs(profileId);
  if (jobs.length === 0) return { skipped: true as const };
  flushing = true;
  try {
    const wipesBefore = offlineWipeCount(profileId);
    const result = await flushOutbox(jobs, liveFlushDeps(), { countAttempts: !background });
    // Signed out and wiped while this was sending: writing the leftovers
    // back would restore work the person chose to discard.
    if (offlineWipeCount(profileId) !== wipesBefore) return result;
    await setOutboxJobs(profileId, result.jobs);
    if (result.failed.length > 0) {
      // Dead-letter, not silence: persisted so the sync banner can show
      // each one with its reason and a Discard control.
      await appendFailedJobs(profileId, result.failed);
      toast.error(
        result.failed.length === 1
          ? "One hearing saved on this device could not be applied. See the sync banner."
          : `${result.failed.length} hearings saved on this device could not be applied. See the sync banner.`,
      );
    }
    if (result.insertedIds.length > 0 || result.updatedIds.length > 0) {
      invalidateHearingQueries();
    }
    if (result.authExpired) {
      // lockCurrentSession keeps the outbox (cache and profile only are
      // wiped), so these jobs are still here for the post-unlock flush.
      void lockCurrentSession();
      notifyAuthExpiredSave();
      return result;
    }
    if (result.stopped && !background) {
      const expired = Date.now() - sessionToastAt > 30_000;
      if (expired) {
        sessionToastAt = Date.now();
        toast.error("Some hearings are still on this device. They will keep retrying.");
      }
    }
    return result;
  } finally {
    flushing = false;
  }
};

export const peekHasDocketWrites = (profileId: string | undefined) => {
  const jobs = getOutboxJobs(profileId);
  return jobs.some((job) => job.kind === "create" || job.kind === "update");
};

/**
 * Work a later flush could still send, for a signed-in, unlocked profile.
 * Locked or signed out is "nothing to retry": the flushes would skip, and
 * unlocking or signing in starts a flush of its own.
 */
const hasSendableWork = () => {
  const { status, user } = useAuthStore.getState();
  if (status !== "authenticated" || !user?.id) return false;
  return getOutboxJobs(user.id).length > 0 || getJudgmentDraftSummary().queued.length > 0;
};

const autoSync = createAutoSync({
  flush: async ({ background }) => {
    await flushPendingHearings({ background });
    await flushQueuedJudgmentDrafts({ countAttempts: !background });
  },
  hasPending: hasSendableWork,
  isOffline: () => isKnownOffline(),
});

/**
 * Sends the hearing outbox and queued judgment text now, waiting for any
 * flush already running and then one more, and keeps retrying with backoff
 * while anything is left. The one entry point for every trigger and for
 * the Sync buttons, so two flushes never overlap.
 */
export const syncOfflineWorkNow = () => autoSync.flushNow();

let listenersStarted = false;

const attachNativeNetworkFlush = async (kick: () => void) => {
  try {
    const native = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (!native?.isNativePlatform?.()) return;
    const { Network } = await import("@capacitor/network");
    Network.addListener("networkStatusChange", (status) => {
      if (status.connected) kick();
    });
  } catch {
    /* plugin missing until `npx cap sync` */
  }
};

/**
 * Starts automatic sync for the life of the app. Called once the offline
 * store is hydrated (the shell only mounts after AuthProvider has loaded
 * it). Flushes:
 *   - straight away, for work left from an earlier session or a reload;
 *   - on every sign-in, unlock or account switch;
 *   - when the browser reports `online`, the tab becomes visible, or the
 *     native network comes back;
 *   - on a backoff timer while anything is still queued, which is what
 *     recovers a write that failed while the browser stayed "online".
 */
export const startOfflineFlushListeners = () => {
  if (listenersStarted || typeof window === "undefined") return;
  listenersStarted = true;
  const kick = () => {
    void syncOfflineWorkNow();
  };
  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") kick();
  });
  void attachNativeNetworkFlush(kick);

  // Something newly queued (a save that could not reach the server) starts
  // the retry timer; it stops by itself once the queue is empty.
  subscribeOfflineStore(autoSync.schedule);
  subscribeJudgmentDrafts(autoSync.schedule);

  let signedInAs: string | null = null;
  const onAuthChange = () => {
    const { status, user } = useAuthStore.getState();
    const active = status === "authenticated" && user?.id ? user.id : null;
    if (active === signedInAs) return;
    signedInAs = active;
    if (!active) return;
    // The draft summary belongs to the previous account until re-read.
    void refreshJudgmentDraftSummary().then(kick);
  };
  useAuthStore.subscribe(onAuthChange);
  onAuthChange();
};

export const syntheticDocketEvent = (
  id: string,
  matterId: string,
  profileId: string,
  payload: HearingFields,
) => {
  const now = new Date().toISOString();
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
  };
};
