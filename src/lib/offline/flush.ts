import {
  hasPendingDocketWrites,
  isLocalEventId,
  rewriteJobIds,
  type HearingFields,
  type OutboxJob,
} from "@/lib/offline/outbox"
import { isPermissionOrValidationError } from "@/lib/offline/is-queueable-error"

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

/**
 * Drain creates, then updates (after rewriting local ids), then Google
 * retries. Stops on a queueable network error so the rest stay queued.
 * Permission errors drop that one job and continue.
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
        if (isPermissionOrValidationError(error)) continue
        remaining.push(job, ...queue)
        return {
          jobs: remaining,
          insertedIds,
          updatedIds,
          googlePendingIds: remaining.filter((item) => item.kind === "googlePending").map((item) => item.id),
          stopped: true,
        }
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
        if (isPermissionOrValidationError(error)) continue
        remaining.push(job, ...queue)
        return {
          jobs: remaining,
          insertedIds,
          updatedIds,
          googlePendingIds: remaining.filter((item) => item.kind === "googlePending").map((item) => item.id),
          stopped: true,
        }
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
