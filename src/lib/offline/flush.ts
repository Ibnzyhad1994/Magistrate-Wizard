import {
  hasPendingDocketWrites,
  isLocalEventId,
  rewriteJobIds,
  type HearingFields,
  type OutboxJob,
} from "@/lib/offline/outbox"
import { isAuthExpiredError, isPermissionOrValidationError } from "@/lib/offline/is-queueable-error"

export type FlushInsertResult = { id: string }

export type GooglePushResult = { synced: boolean; skipped?: boolean }

export type FlushDeps = {
  insertEvent: (matterId: string, payload: HearingFields) => Promise<FlushInsertResult>
  updateEvent: (id: string, payload: HearingFields) => Promise<void>
  pushGoogle: (eventId: string) => Promise<GooglePushResult>
}

export type FlushResult = {
  jobs: OutboxJob[]
  insertedIds: string[]
  updatedIds: string[]
  googlePendingIds: string[]
  stopped: boolean
  authExpired?: boolean
}

const maybeGooglePending = (
  remaining: OutboxJob[],
  eventId: string,
  matterId: string,
  google: GooglePushResult,
): OutboxJob[] => {
  if (google.synced || google.skipped) return remaining
  if (remaining.some((job) => job.kind === "googlePending" && job.id === eventId)) return remaining
  remaining.push({ kind: "googlePending", id: eventId, matterId })
  return remaining
}

const stoppedResult = (
  remaining: OutboxJob[],
  insertedIds: string[],
  updatedIds: string[],
  authExpired = false,
): FlushResult => ({
  jobs: remaining,
  insertedIds,
  updatedIds,
  googlePendingIds: remaining.filter((item) => item.kind === "googlePending").map((item) => item.id),
  stopped: true,
  authExpired,
})

const handleJobError = (
  error: unknown,
  job: OutboxJob,
  queue: OutboxJob[],
  remaining: OutboxJob[],
  insertedIds: string[],
  updatedIds: string[],
): FlushResult | "drop" => {
  if (isAuthExpiredError(error)) {
    remaining.push(job, ...queue)
    return stoppedResult(remaining, insertedIds, updatedIds, true)
  }
  if (isPermissionOrValidationError(error)) return "drop"
  remaining.push(job, ...queue)
  return stoppedResult(remaining, insertedIds, updatedIds)
}

/**
 * Drain creates, then updates (after rewriting local ids), then Google
 * retries. Stops on a queueable network error so the rest stay queued.
 * Permission errors drop that one job and continue. Expired JWTs keep
 * the job and stop so the user can re-auth without losing the save.
 */
export const flushOutbox = async (jobs: OutboxJob[], deps: FlushDeps): Promise<FlushResult> => {
  let queue = jobs.map((job) => ({ ...job }))
  const insertedIds: string[] = []
  const updatedIds: string[] = []
  const remaining: OutboxJob[] = []

  while (queue.length > 0) {
    const job = queue.shift() as OutboxJob
    if (job.kind === "create") {
      try {
        const inserted = await deps.insertEvent(job.matterId, job.payload)
        insertedIds.push(inserted.id)
        queue = rewriteJobIds(queue, job.id, inserted.id)
        const google = await deps.pushGoogle(inserted.id)
        maybeGooglePending(remaining, inserted.id, job.matterId, google)
      } catch (error) {
        const handled = handleJobError(error, job, queue, remaining, insertedIds, updatedIds)
        if (handled === "drop") continue
        return handled
      }
      continue
    }

    if (job.kind === "update") {
      if (isLocalEventId(job.id)) {
        remaining.push(job)
        continue
      }
      try {
        await deps.updateEvent(job.id, job.payload)
        updatedIds.push(job.id)
        const google = await deps.pushGoogle(job.id)
        maybeGooglePending(remaining, job.id, job.matterId, google)
      } catch (error) {
        const handled = handleJobError(error, job, queue, remaining, insertedIds, updatedIds)
        if (handled === "drop") continue
        return handled
      }
      continue
    }

    if (isLocalEventId(job.id)) {
      remaining.push(job)
      continue
    }
    const google = await deps.pushGoogle(job.id)
    maybeGooglePending(remaining, job.id, job.matterId, google)
  }

  return {
    jobs: remaining,
    insertedIds,
    updatedIds,
    googlePendingIds: remaining.filter((item) => item.kind === "googlePending").map((item) => item.id),
    stopped: false,
  }
}

export const shouldSkipGooglePull = (jobs: OutboxJob[]) => hasPendingDocketWrites(jobs)
