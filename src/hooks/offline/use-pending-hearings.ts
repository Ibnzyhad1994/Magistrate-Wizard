import { useMemo, useSyncExternalStore } from "react"
import { useAuthStore } from "@/store/auth-store"
import { pendingEventIds, pendingJobCount, type OutboxJob } from "@/lib/offline/outbox"
import { getOutboxJobs, subscribeOfflineStore } from "@/lib/offline/store"

const EMPTY: OutboxJob[] = []

export function useOutboxJobs() {
  const profileId = useAuthStore((state) => state.user?.id)
  const jobs = useSyncExternalStore(
    subscribeOfflineStore,
    () => (profileId ? getOutboxJobs(profileId) : EMPTY),
    () => EMPTY,
  )
  return jobs
}

export function usePendingHearings() {
  const jobs = useOutboxJobs()
  const count = pendingJobCount(jobs)
  const eventIds = useMemo(() => pendingEventIds(jobs), [jobs])
  return { jobs, count, eventIds }
}
