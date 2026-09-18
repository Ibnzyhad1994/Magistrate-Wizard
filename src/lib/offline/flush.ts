import type { TablesUpdate } from "@/types";
import {
  hasPendingDocketWrites,
  isLocalEventId,
  MAX_UNCLASSIFIED_ATTEMPTS,
  rewriteJobIds,
  type CreateOutboxJob,
  type FailedOutboxJob,
  type HearingFields,
  type MatterPatchJob,
  type OutboxJob,
  type UpdateOutboxJob,
} from "@/lib/offline/outbox";
import {
  isAuthExpiredError,
  isPermissionOrValidationError,
} from "@/lib/offline/is-queueable-error";

export type FlushInsertResult = { id: string };

export type GooglePushResult = { synced: boolean; skipped?: boolean };

/** `{ conflict: true }` means the guarded UPDATE matched no row (changed elsewhere, or no longer visible). */
export type FlushUpdateResult = void | { conflict?: boolean };

export type FlushDeps = {
  insertEvent: (matterId: string, payload: HearingFields) => Promise<FlushInsertResult>;
  /**
   * Replays a coalesced board change. Same guarded UPDATE the online path
   * uses, so a row changed elsewhere reports a conflict rather than being
   * overwritten. Optional so an existing caller that only queues hearings
   * keeps working unchanged.
   */
  patchMatter?: (
    matterId: string,
    patch: TablesUpdate<"docket_matters">,
    baseUpdatedAt?: string | null,
  ) => Promise<FlushUpdateResult>;
  updateEvent: (
    id: string,
    payload: HearingFields,
    baseUpdatedAt?: string | null,
  ) => Promise<FlushUpdateResult>;
  pushGoogle: (eventId: string) => Promise<GooglePushResult>;
};

export type FlushResult = {
  jobs: OutboxJob[];
  insertedIds: string[];
  updatedIds: string[];
  googlePendingIds: string[];
  /** Jobs removed from the queue without being saved. Never empty silently: the caller persists and shows these. */
  failed: FailedOutboxJob[];
  stopped: boolean;
  authExpired?: boolean;
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return "The server refused this save.";
};

const failedJob = (
  job: CreateOutboxJob | UpdateOutboxJob | MatterPatchJob,
  reason: FailedOutboxJob["reason"],
  message: string,
): FailedOutboxJob => ({ job, reason, message, failedAt: new Date().toISOString() });

const maybeGooglePending = (
  remaining: OutboxJob[],
  eventId: string,
  matterId: string,
  google: GooglePushResult,
): OutboxJob[] => {
  if (google.synced || google.skipped) return remaining;
  if (remaining.some((job) => job.kind === "googlePending" && job.id === eventId)) return remaining;
  remaining.push({ kind: "googlePending", id: eventId, matterId });
  return remaining;
};

const stoppedResult = (
  remaining: OutboxJob[],
  insertedIds: string[],
  updatedIds: string[],
  failed: FailedOutboxJob[],
  authExpired = false,
): FlushResult => ({
  jobs: remaining,
  insertedIds,
  updatedIds,
  googlePendingIds: remaining
    .filter((item) => item.kind === "googlePending")
    .map((item) => item.id),
  failed,
  stopped: true,
  authExpired,
});

const handleJobError = (
  error: unknown,
  job: CreateOutboxJob | UpdateOutboxJob | MatterPatchJob,
  queue: OutboxJob[],
  remaining: OutboxJob[],
  insertedIds: string[],
  updatedIds: string[],
  failed: FailedOutboxJob[],
): FlushResult | "drop" => {
  if (isAuthExpiredError(error)) {
    remaining.push(job, ...queue);
    return stoppedResult(remaining, insertedIds, updatedIds, failed, true);
  }
  if (isPermissionOrValidationError(error)) {
    // Not retried, but not lost either: it goes to the failed list with
    // the server's reason so the person can see what did not save.
    failed.push(failedJob(job, "dropped", errorMessage(error)));
    return "drop";
  }
  // Anything else is assumed transient and the drain stops so the rest
  // stay queued in order. Bounded, because an error we cannot classify
  // would otherwise retry on every reconnect forever and keep every job
  // behind it from ever reaching the server.
  const attempts = (job.attempts ?? 0) + 1;
  if (attempts >= MAX_UNCLASSIFIED_ATTEMPTS) {
    failed.push(failedJob(job, "stalled", errorMessage(error)));
    return "drop";
  }
  remaining.push({ ...job, attempts }, ...queue);
  return stoppedResult(remaining, insertedIds, updatedIds, failed);
};

/**
 * Drain creates, then updates (after rewriting local ids), then Google
 * retries. Stops on a queueable network error so the rest stay queued.
 * Permission errors move that one job to `failed` and continue. Updates
 * are guarded by the base `updated_at`; a zero-row match is a conflict,
 * also moved to `failed`. Expired JWTs keep the job and stop so the user
 * can re-auth without losing the save.
 */
/**
 * Creates first, because rewriteJobIds has to turn `local:` ids into real
 * ones before anything downstream references them. Board changes next, so
 * a matter's stage is current before any scheduling call stamps
 * stage_at_event from it. Google pushes last: they are a mirror, and must
 * never delay a legal save. Stable within each kind, so two changes to
 * the same record keep the order they were made in.
 */
const DRAIN_ORDER: Record<OutboxJob["kind"], number> = {
  create: 0,
  matterPatch: 1,
  update: 2,
  googlePending: 3,
};

export const flushOutbox = async (jobs: OutboxJob[], deps: FlushDeps): Promise<FlushResult> => {
  let queue = jobs
    .map((job, index) => ({ job: { ...job }, index }))
    .sort((a, b) => DRAIN_ORDER[a.job.kind] - DRAIN_ORDER[b.job.kind] || a.index - b.index)
    .map((entry) => entry.job);
  const insertedIds: string[] = [];
  const updatedIds: string[] = [];
  const remaining: OutboxJob[] = [];
  const failed: FailedOutboxJob[] = [];

  while (queue.length > 0) {
    const job = queue.shift() as OutboxJob;
    if (job.kind === "create") {
      try {
        const inserted = await deps.insertEvent(job.matterId, job.payload);
        insertedIds.push(inserted.id);
        queue = rewriteJobIds(queue, job.id, inserted.id);
        const google = await deps.pushGoogle(inserted.id);
        maybeGooglePending(remaining, inserted.id, job.matterId, google);
      } catch (error) {
        const handled = handleJobError(
          error,
          job,
          queue,
          remaining,
          insertedIds,
          updatedIds,
          failed,
        );
        if (handled === "drop") continue;
        return handled;
      }
      continue;
    }

    if (job.kind === "matterPatch") {
      if (!deps.patchMatter) {
        remaining.push(job);
        continue;
      }
      try {
        const outcome = await deps.patchMatter(job.matterId, job.patch, job.baseUpdatedAt ?? null);
        if (outcome && outcome.conflict) {
          failed.push(
            failedJob(
              job,
              "conflict",
              "This file was changed by someone else after you edited it offline, so your board changes were not applied.",
            ),
          );
          continue;
        }
        updatedIds.push(job.id);
      } catch (error) {
        const handled = handleJobError(
          error,
          job,
          queue,
          remaining,
          insertedIds,
          updatedIds,
          failed,
        );
        if (handled === "drop") continue;
        return handled;
      }
      continue;
    }

    if (job.kind === "update") {
      if (isLocalEventId(job.id)) {
        remaining.push(job);
        continue;
      }
      try {
        const outcome = await deps.updateEvent(job.id, job.payload, job.baseUpdatedAt ?? null);
        if (outcome && outcome.conflict) {
          failed.push(
            failedJob(
              job,
              "conflict",
              "This hearing was changed elsewhere after you edited it offline, so your version was not applied.",
            ),
          );
          continue;
        }
        updatedIds.push(job.id);
        const google = await deps.pushGoogle(job.id);
        maybeGooglePending(remaining, job.id, job.matterId, google);
      } catch (error) {
        const handled = handleJobError(
          error,
          job,
          queue,
          remaining,
          insertedIds,
          updatedIds,
          failed,
        );
        if (handled === "drop") continue;
        return handled;
      }
      continue;
    }

    if (isLocalEventId(job.id)) {
      remaining.push(job);
      continue;
    }
    const google = await deps.pushGoogle(job.id);
    maybeGooglePending(remaining, job.id, job.matterId, google);
  }

  return {
    jobs: remaining,
    insertedIds,
    updatedIds,
    googlePendingIds: remaining
      .filter((item) => item.kind === "googlePending")
      .map((item) => item.id),
    failed,
    stopped: false,
  };
};

export const shouldSkipGooglePull = (jobs: OutboxJob[]) => hasPendingDocketWrites(jobs);
