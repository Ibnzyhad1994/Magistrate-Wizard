import { useMemo, useSyncExternalStore } from "react";
import { useAuthStore } from "@/store/auth-store";
import {
  pendingEventIds,
  pendingJobCount,
  pendingMatterIds,
  type FailedOutboxJob,
  type OutboxJob,
} from "@/lib/offline/outbox";
import {
  getFailedJobs,
  getOutboxJobs,
  isDeviceStorageFull,
  subscribeOfflineStore,
} from "@/lib/offline/store";
import {
  getJudgmentDraftSummary,
  subscribeJudgmentDrafts,
} from "@/lib/offline/judgment-drafts-runtime";

/** Judgment text held on this device: waiting to sync, or needing a choice. */
export function useJudgmentDraftSummary() {
  return useSyncExternalStore(
    subscribeJudgmentDrafts,
    getJudgmentDraftSummary,
    getJudgmentDraftSummary,
  );
}

const EMPTY: OutboxJob[] = [];
const EMPTY_FAILED: FailedOutboxJob[] = [];

/** Queued hearings the flush gave up on (permission refusal or conflict), until discarded. */
export function useFailedHearings() {
  const profileId = useAuthStore((state) => state.user?.id);
  return useSyncExternalStore(
    subscribeOfflineStore,
    () => (profileId ? getFailedJobs(profileId) : EMPTY_FAILED),
    () => EMPTY_FAILED,
  );
}

/**
 * True when the device store is full, so queued work is held in memory
 * only. It still flushes in this session; it will not survive a reload.
 */
export function useDeviceStorageFull() {
  return useSyncExternalStore(subscribeOfflineStore, isDeviceStorageFull, () => false);
}

export function useOutboxJobs() {
  const profileId = useAuthStore((state) => state.user?.id);
  const jobs = useSyncExternalStore(
    subscribeOfflineStore,
    () => (profileId ? getOutboxJobs(profileId) : EMPTY),
    () => EMPTY,
  );
  return jobs;
}

/** Matter ids with queued board changes, for marking their row pending. */
export function usePendingMatterIds() {
  const jobs = useOutboxJobs();
  return useMemo(() => pendingMatterIds(jobs), [jobs]);
}

export function usePendingHearings() {
  const jobs = useOutboxJobs();
  const count = pendingJobCount(jobs);
  const eventIds = useMemo(() => pendingEventIds(jobs), [jobs]);
  return { jobs, count, eventIds };
}
