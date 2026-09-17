import {
  enqueueCreate,
  enqueueUpdate,
  mergeCalendarRows,
  rewriteJobIds,
  makeLocalEventId,
} from "../../src/lib/offline/outbox.ts";
import { isQueueableError } from "../../src/lib/offline/is-queueable-error.ts";
import { flushOutbox } from "../../src/lib/offline/flush.ts";

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

const baseFields = (overrides = {}) => ({
  scheduled_date: "2026-08-24",
  scheduled_time: "10:00:00",
  event_type: "mention",
  location: "Court 1",
  stage_at_event: null,
  outcome_at_event: null,
  orders_made_at_event: null,
  notes: null,
  event_status: "scheduled",
  ...overrides,
});

const localId = makeLocalEventId(() => "temp-1");
check("local ids use the local: prefix", localId.startsWith("local:"), true);

let jobs = enqueueCreate([], {
  kind: "create",
  id: localId,
  matterId: "mat-1",
  payload: baseFields(),
  caseNumber: "GEO-1",
  matterTitle: "Police v. Test",
});
jobs = enqueueUpdate(jobs, {
  id: localId,
  matterId: "mat-1",
  patch: { scheduled_time: "11:30:00", location: "Court 2" },
  base: baseFields(),
  caseNumber: "GEO-1",
  matterTitle: "Police v. Test",
});
check("coalesce create+edit into one insert job", jobs.length, 1);
check("coalesced payload uses later time", jobs[0].payload.scheduled_time, "11:30:00");
check("coalesced payload uses later location", jobs[0].payload.location, "Court 2");
check("coalesced job stays a create", jobs[0].kind, "create");

const rewritten = rewriteJobIds(
  [
    {
      kind: "update",
      id: localId,
      matterId: "mat-1",
      payload: baseFields(),
      caseNumber: "GEO-1",
      matterTitle: "Police v. Test",
    },
    { kind: "googlePending", id: localId, matterId: "mat-1" },
  ],
  localId,
  "real-uuid",
);
check("rewrite replaces local id on update", rewritten[0].id, "real-uuid");
check("rewrite replaces local id on googlePending", rewritten[1].id, "real-uuid");

check("403 is not queued", isQueueableError({ status: 403 }), false);
check("42501 RLS is not queued", isQueueableError({ code: "42501" }), false);
check("TypeError is queued", isQueueableError(new TypeError("Failed to fetch")), true);
check("offline navigator queues generic errors", isQueueableError(new Error("boom"), false), true);
check("offline still does not queue 403", isQueueableError({ status: 403 }, false), false);

const snapshot = [
  {
    id: "evt-live",
    docket_matter_id: "mat-1",
    scheduled_date: "2026-08-20",
    scheduled_time: "09:30:00",
    location: "Court 1",
    event_type: "trial",
    event_status: "scheduled",
    case_number: "GEO-1",
    matter_title: "Police v. Test",
  },
];
const merged = mergeCalendarRows(
  snapshot,
  [
    {
      kind: "create",
      id: localId,
      matterId: "mat-1",
      payload: baseFields({ scheduled_date: "2026-08-26" }),
      caseNumber: "GEO-1",
      matterTitle: "Police v. Test",
    },
    {
      kind: "update",
      id: "evt-live",
      matterId: "mat-1",
      payload: baseFields({ scheduled_date: "2026-08-21", scheduled_time: "14:00:00" }),
      caseNumber: "GEO-1",
      matterTitle: "Police v. Test",
    },
  ],
  "2026-08-01",
  "2026-08-31",
);
check("calendar merge keeps snapshot plus pending create", merged.length, 2);
check(
  "pending update overlays date/time",
  merged.find((row) => row.id === "evt-live")?.scheduled_date,
  "2026-08-21",
);
check(
  "pending update overlays time",
  merged.find((row) => row.id === "evt-live")?.scheduled_time,
  "14:00:00",
);
check("pending create is marked pending", merged.find((row) => row.id === localId)?.pending, true);

const inserts = [];
const updates = [];
const googleCalls = [];
const createThenUpdate = [
  {
    kind: "create",
    id: localId,
    matterId: "mat-1",
    payload: baseFields(),
    caseNumber: "GEO-1",
    matterTitle: "Police v. Test",
  },
  {
    kind: "update",
    id: localId,
    matterId: "mat-1",
    payload: baseFields({ scheduled_time: "15:00:00" }),
    caseNumber: "GEO-1",
    matterTitle: "Police v. Test",
  },
];
const flushed = await flushOutbox(createThenUpdate, {
  insertEvent: async (_matterId, payload) => {
    inserts.push(payload);
    return { id: "real-uuid" };
  },
  updateEvent: async (id, payload) => {
    updates.push({ id, payload });
  },
  pushGoogle: async (eventId) => {
    googleCalls.push(eventId);
    return { synced: true };
  },
});
check("flush insert called once for create+update pair", inserts.length, 1);
check("flush update uses rewritten real id", updates[0]?.id, "real-uuid");
check("flush update uses later time", updates[0]?.payload.scheduled_time, "15:00:00");
check(
  "flush google uses real id",
  googleCalls.every((id) => id === "real-uuid"),
  true,
);
check("flush leaves no jobs when google succeeds", flushed.jobs.length, 0);

const googleDownInserts = [];
const googleDown = await flushOutbox(
  [
    {
      kind: "create",
      id: localId,
      matterId: "mat-1",
      payload: baseFields(),
      caseNumber: "GEO-1",
      matterTitle: "Police v. Test",
    },
  ],
  {
    insertEvent: async () => {
      googleDownInserts.push(1);
      return { id: "real-uuid" };
    },
    updateEvent: async () => {},
    pushGoogle: async () => ({ synced: false }),
  },
);
check("google down after insert does not duplicate docket row", googleDownInserts.length, 1);
check(
  "google down leaves googlePending",
  googleDown.jobs.map((job) => job.kind),
  ["googlePending"],
);
check("googlePending uses real event id", googleDown.jobs[0]?.id, "real-uuid");

{
  const { isAuthExpiredError, isPermissionOrValidationError, isQueueableError } =
    await import("../../src/lib/offline/is-queueable-error.ts");
  check(
    "401 is auth-expired, not queued, not dropped as permission",
    isAuthExpiredError({ status: 401 }),
    true,
  );
  check("PGRST301 is auth-expired", isAuthExpiredError({ code: "PGRST301" }), true);
  check("403 is not auth-expired", isAuthExpiredError({ status: 403 }), false);
  check("401 is not a permission drop", isPermissionOrValidationError({ status: 401 }), false);
  check(
    "PGRST301 is not a permission drop",
    isPermissionOrValidationError({ code: "PGRST301" }),
    false,
  );
  check("403 is still a permission drop", isPermissionOrValidationError({ status: 403 }), true);
  check("401 is not an offline queueable error", isQueueableError({ status: 401 }), false);
}

const authExpiredJob = {
  kind: "create",
  id: localId,
  matterId: "mat-1",
  payload: baseFields(),
  caseNumber: "GEO-1",
  matterTitle: "Police v. Test",
};
const authExpiredFlush = await flushOutbox([authExpiredJob], {
  insertEvent: async () => {
    throw { status: 401, message: "JWT expired" };
  },
  updateEvent: async () => {},
  pushGoogle: async () => ({ synced: true }),
});
check("401 flush keeps the create job", authExpiredFlush.jobs.length, 1);
check("401 flush marks authExpired", authExpiredFlush.authExpired, true);
check("401 flush stops", authExpiredFlush.stopped, true);

const forbiddenFlush = await flushOutbox([authExpiredJob], {
  insertEvent: async () => {
    throw { status: 403 };
  },
  updateEvent: async () => {},
  pushGoogle: async () => ({ synced: true }),
});
check("403 flush drops the job", forbiddenFlush.jobs.length, 0);
check("403 flush is not authExpired", Boolean(forbiddenFlush.authExpired), false);
check("403 flush moves the job to the failed list", forbiddenFlush.failed.length, 1);
check("dropped job keeps the reason", forbiddenFlush.failed[0]?.reason, "dropped");
check("dropped job keeps the original payload", forbiddenFlush.failed[0]?.job.id, localId);
check("dropped job records a message", typeof forbiddenFlush.failed[0]?.message, "string");
check("successful flush has an empty failed list", flushed.failed, []);

// --- updated_at guard on replayed updates ----------------------------------
{
  const guarded = enqueueUpdate([], {
    id: "evt-live",
    matterId: "mat-1",
    patch: { location: "Court 3" },
    base: baseFields(),
    caseNumber: "GEO-1",
    matterTitle: "Police v. Test",
    baseUpdatedAt: "2026-08-20T10:00:00+00:00",
  });
  check(
    "queued update carries the base updated_at",
    guarded[0]?.baseUpdatedAt,
    "2026-08-20T10:00:00+00:00",
  );
  const guardedAgain = enqueueUpdate(guarded, {
    id: "evt-live",
    matterId: "mat-1",
    patch: { notes: "later" },
    base: baseFields(),
    caseNumber: "GEO-1",
    matterTitle: "Police v. Test",
    baseUpdatedAt: "2026-08-21T10:00:00+00:00",
  });
  check(
    "a second offline edit keeps the first base updated_at",
    guardedAgain[0]?.baseUpdatedAt,
    "2026-08-20T10:00:00+00:00",
  );
  check("a second offline edit still merges the patch", guardedAgain[0]?.payload.notes, "later");

  const seenBases = [];
  const guardedFlush = await flushOutbox(guardedAgain, {
    insertEvent: async () => ({ id: "unused" }),
    updateEvent: async (_id, _payload, baseUpdatedAt) => {
      seenBases.push(baseUpdatedAt);
    },
    pushGoogle: async () => ({ synced: true }),
  });
  check("flush passes the base updated_at to the update", seenBases, ["2026-08-20T10:00:00+00:00"]);
  check("guarded update that matched is applied", guardedFlush.updatedIds, ["evt-live"]);

  const conflictFlush = await flushOutbox(guardedAgain, {
    insertEvent: async () => ({ id: "unused" }),
    updateEvent: async () => ({ conflict: true }),
    pushGoogle: async () => ({ synced: true }),
  });
  check("zero-row guarded update is not counted as applied", conflictFlush.updatedIds, []);
  check("zero-row guarded update leaves no job queued", conflictFlush.jobs, []);
  check(
    "zero-row guarded update is reported as a conflict",
    conflictFlush.failed[0]?.reason,
    "conflict",
  );
  check(
    "conflict keeps the person's payload for review",
    conflictFlush.failed[0]?.job.payload.location,
    "Court 3",
  );
  check("conflict does not stop the flush", conflictFlush.stopped, false);

  const legacyJob = {
    kind: "update",
    id: "evt-live",
    matterId: "mat-1",
    payload: baseFields(),
    caseNumber: "GEO-1",
    matterTitle: "Police v. Test",
  };
  const legacyBases = [];
  await flushOutbox([legacyJob], {
    insertEvent: async () => ({ id: "unused" }),
    updateEvent: async (_id, _payload, baseUpdatedAt) => {
      legacyBases.push(baseUpdatedAt);
    },
    pushGoogle: async () => ({ synced: true }),
  });
  check("a job queued before the guard existed replays unguarded", legacyBases, [null]);
}

// --- failed list is persisted per profile, and survives a lock-style wipe ----
{
  const {
    appendFailedJobs,
    clearOfflineCacheForProfile,
    clearOfflineForProfile,
    discardFailedJob,
    getFailedJobs,
    getOutboxJobs,
    setOutboxJobs,
  } = await import("../../src/lib/offline/store.ts");
  const job = {
    kind: "create",
    id: localId,
    matterId: "mat-1",
    payload: baseFields(),
    caseNumber: "GEO-1",
    matterTitle: "Police v. Test",
  };
  await setOutboxJobs("user-x", [job]);
  await appendFailedJobs("user-x", [
    { job, reason: "dropped", message: "403", failedAt: "2026-08-24T00:00:00Z" },
  ]);
  check("failed list is readable per profile", getFailedJobs("user-x").length, 1);
  check("failed list is empty for another profile", getFailedJobs("user-y"), []);
  await clearOfflineCacheForProfile("user-x");
  check("cache-only wipe keeps the outbox", getOutboxJobs("user-x").length, 1);
  check("cache-only wipe keeps the failed list", getFailedJobs("user-x").length, 1);
  await discardFailedJob("user-x", localId);
  check("discard removes one failed entry", getFailedJobs("user-x"), []);
  await clearOfflineForProfile("user-x");
  check("full sign-out wipe clears the outbox", getOutboxJobs("user-x"), []);
}

if (failures > 0) {
  console.error(`${failures} offline outbox checks failed`);
  process.exit(1);
}
console.log("All offline outbox checks passed");
