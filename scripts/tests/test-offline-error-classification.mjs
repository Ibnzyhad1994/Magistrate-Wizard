/**
 * Offline queue integrity: how a failed write is classified, and what a
 * failure that cannot be classified does to the jobs behind it.
 *
 * Three real defects are pinned here:
 *
 *  1. A full device store was swallowed as "private mode", so the outbox
 *     was told a save succeeded when nothing was written. The work then
 *     disappeared on the next reload.
 *  2. A bare `raise exception` in a Postgres function arrives as P0001,
 *     which was in neither the permission nor the auth-expired set. The
 *     flush treats anything it cannot classify as transient and stops the
 *     whole drain, so one permanently-refused job blocked every job
 *     behind it on every reconnect, forever.
 *  3. Nothing bounded that retry.
 *
 *   npm run test:offline-error-classification
 */
import {
  isAuthExpiredError,
  isPermissionOrValidationError,
  isQueueableError,
} from "../../src/lib/offline/is-queueable-error.ts";
import { flushOutbox } from "../../src/lib/offline/flush.ts";
import { MAX_UNCLASSIFIED_ATTEMPTS } from "../../src/lib/offline/outbox.ts";
import { DeviceStorageQuotaError } from "../../src/lib/device-storage.ts";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}

// --- a full device store is distinguishable from an unavailable one --------

const quota = new DeviceStorageQuotaError("mw.offline-outbox.v1");
check("a quota failure is its own error type", quota instanceof DeviceStorageQuotaError, true);
check("it names the key that did not persist", quota.key, "mw.offline-outbox.v1");
check(
  "it is an Error, so an unguarded caller still sees a real failure",
  quota instanceof Error,
  true,
);

// --- P0001: a bare `raise exception` is permanent, not transient -----------

const raised = {
  code: "P0001",
  message: "Not authorized to schedule Docket Events on this matter.",
};
check("P0001 is a permission refusal", isPermissionOrValidationError(raised), true);
check("P0001 is not an expired session", isAuthExpiredError(raised), false);
check("P0001 is therefore not queueable while online", isQueueableError(raised, true), false);

// Some refusals carry no useful SQLSTATE at all.
check(
  "a not-authorised message is a refusal even without a code",
  isPermissionOrValidationError({ message: "permission denied for table docket_events" }),
  true,
);
check(
  "an RLS violation message is a refusal",
  isPermissionOrValidationError({
    message: 'new row violates row-level security policy for table "docket_events"',
  }),
  true,
);

// The classifications that already worked must not regress.
check(
  "a genuine network failure is still queueable",
  isQueueableError(new TypeError("Failed to fetch"), true),
  true,
);
check(
  "an expired JWT still pauses rather than dropping",
  isAuthExpiredError({ code: "PGRST301", message: "JWT expired" }),
  true,
);
check(
  "an expired JWT is never treated as a refusal",
  isPermissionOrValidationError({ code: "PGRST301", message: "JWT expired" }),
  false,
);

// --- an unclassifiable failure must not stall the queue -------------------

const fields = {
  scheduled_date: "2026-11-03",
  scheduled_time: "09:00:00",
  event_type: "mention",
  location: null,
  stage_at_event: null,
  outcome_at_event: null,
  orders_made_at_event: null,
  notes: null,
  event_status: "scheduled",
};

const job = (id, attempts) => ({
  kind: "update",
  id,
  matterId: "mat-1",
  payload: fields,
  caseNumber: "GEO-2026-001",
  matterTitle: "Police v. Demo Defendant",
  ...(attempts === undefined ? {} : { attempts }),
});

// Something the classifier has no opinion about at all.
const weird = { code: "XX999", message: "internal error" };
const alwaysFails = {
  insertEvent: async () => {
    throw weird;
  },
  updateEvent: async () => {
    throw weird;
  },
  pushGoogle: async () => ({ synced: true }),
};

const firstAttempt = await flushOutbox([job("evt-1"), job("evt-2")], alwaysFails);
check("an unclassified failure still stops the drain", firstAttempt.stopped, true);
check("both jobs stay queued", firstAttempt.jobs.length, 2);
check("the failing job records an attempt", firstAttempt.jobs[0].attempts, 1);
check("the job behind it is untouched", firstAttempt.jobs[1].attempts, undefined);
check("nothing is dead-lettered yet", firstAttempt.failed.length, 0);

// One attempt short of the bound: still retrying.
const nearlyStalled = await flushOutbox(
  [job("evt-1", MAX_UNCLASSIFIED_ATTEMPTS - 2), job("evt-2")],
  alwaysFails,
);
check("below the bound it is still retried", nearlyStalled.jobs.length, 2);
check("nothing dead-lettered below the bound", nearlyStalled.failed.length, 0);

// At the bound: set aside so the rest of the queue can move.
const stalled = await flushOutbox(
  [job("evt-1", MAX_UNCLASSIFIED_ATTEMPTS - 1), job("evt-2")],
  alwaysFails,
);
check("at the bound it is dead-lettered", stalled.failed.length, 1);
check("with a reason that is not a refusal", stalled.failed[0].reason, "stalled");
check("the server's own message is kept", stalled.failed[0].message, "internal error");
check("it no longer sits in the queue", stalled.jobs.some((j) => j.id === "evt-1"), false);
check("the job behind it survives to be retried", stalled.jobs.some((j) => j.id === "evt-2"), true);

// A refusal must still dead-letter immediately, without burning attempts.
const refused = await flushOutbox([job("evt-1")], {
  insertEvent: async () => {
    throw raised;
  },
  updateEvent: async () => {
    throw raised;
  },
  pushGoogle: async () => ({ synced: true }),
});
check("a P0001 refusal dead-letters on the first try", refused.failed.length, 1);
check("and is recorded as dropped, not stalled", refused.failed[0].reason, "dropped");
check("the drain is not stopped by a refusal", refused.stopped, false);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
