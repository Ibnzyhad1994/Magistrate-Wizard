/**
 * Queued procedure-board changes (B2).
 *
 * Before this, only hearings survived a dropped signal. The board cells —
 * what a magistrate touches constantly while sitting — went through a
 * guarded UPDATE that simply threw, and the optimistic paint rolled back,
 * so a morning's work could vanish on a bad connection.
 *
 * The rules being pinned here are the ones that are easy to get wrong and
 * silent when wrong:
 *
 *  - changes to one matter COALESCE into one job (cells are absolute
 *    values, not deltas, so replaying intermediates buys nothing and
 *    would force dropping the updated_at guard for every write after the
 *    first);
 *  - the FIRST baseUpdatedAt is kept, because that is the row version the
 *    person actually saw;
 *  - different matters never merge;
 *  - a row changed elsewhere is a conflict to report, never an overwrite;
 *  - board changes drain before hearing updates, so a matter's stage is
 *    current before anything stamps stage_at_event from it.
 *
 *   npm run test:offline-matter-patch
 */
import {
  describeFailedJob,
  enqueueMatterPatch,
  matterPatchJobId,
  pendingMatterIds,
  pendingMatterPatch,
} from "../../src/lib/offline/outbox.ts";
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

const labels = { caseNumber: "GEO-2026-001", matterTitle: "Police v. Demo Defendant" };

// --- coalescing -----------------------------------------------------------

let jobs = enqueueMatterPatch([], {
  matterId: "mat-1",
  patch: { disclosure_status: "partial" },
  baseUpdatedAt: "2026-09-18T08:00:00Z",
  ...labels,
});
jobs = enqueueMatterPatch(jobs, {
  matterId: "mat-1",
  patch: { disclosure_status: "full" },
  baseUpdatedAt: "2026-09-18T09:99:00Z",
  ...labels,
});
jobs = enqueueMatterPatch(jobs, {
  matterId: "mat-1",
  patch: { trial_status: "completed" },
  baseUpdatedAt: "2026-09-18T10:00:00Z",
  ...labels,
});

check("three changes to one matter make one job", jobs.length, 1);
check("the job is keyed by matter", jobs[0].id, matterPatchJobId("mat-1"));
check("last write per column wins", jobs[0].patch.disclosure_status, "full");
check("other columns are kept", jobs[0].patch.trial_status, "completed");
check(
  "the FIRST row version is retained, not the newest",
  jobs[0].baseUpdatedAt,
  "2026-09-18T08:00:00Z",
);
check("every touched column is recorded once", jobs[0].columns, [
  "disclosure_status",
  "trial_status",
]);

jobs = enqueueMatterPatch(jobs, {
  matterId: "mat-2",
  patch: { custody_status: "remanded" },
  baseUpdatedAt: "2026-09-18T11:00:00Z",
  ...labels,
});
check("a different matter gets its own job", jobs.length, 2);
check("and its own row version", jobs[1].baseUpdatedAt, "2026-09-18T11:00:00Z");

check("pending matters are reported for the UI", [...pendingMatterIds(jobs)].sort(), [
  "mat-1",
  "mat-2",
]);
check("one matter's queued change is findable", pendingMatterPatch(jobs, "mat-2").patch, {
  custody_status: "remanded",
});
check("a matter with nothing queued returns null", pendingMatterPatch(jobs, "mat-9"), null);

// --- replay ---------------------------------------------------------------

const calls = [];
const ok = {
  insertEvent: async () => ({ id: "real" }),
  updateEvent: async () => {},
  patchMatter: async (matterId, patch, baseUpdatedAt) => {
    calls.push({ matterId, patch, baseUpdatedAt });
  },
  pushGoogle: async () => ({ synced: true }),
};

const flushed = await flushOutbox(jobs, ok);
check("both jobs replay", calls.length, 2);
check("the coalesced patch is sent once, whole", calls[0].patch, {
  disclosure_status: "full",
  trial_status: "completed",
});
check("guarded by the version first seen", calls[0].baseUpdatedAt, "2026-09-18T08:00:00Z");
check("the queue drains empty", flushed.jobs.length, 0);
check("nothing is dead-lettered on success", flushed.failed.length, 0);

// --- conflict -------------------------------------------------------------

const conflicted = await flushOutbox(
  [
    {
      kind: "matterPatch",
      id: matterPatchJobId("mat-1"),
      matterId: "mat-1",
      patch: { trial_status: "completed" },
      baseUpdatedAt: "2026-09-18T08:00:00Z",
      columns: ["trial_status"],
      ...labels,
    },
  ],
  { ...ok, patchMatter: async () => ({ conflict: true }) },
);
check("a row changed elsewhere is a conflict", conflicted.failed[0]?.reason, "conflict");
check("it is not left in the queue", conflicted.jobs.length, 0);
check(
  "the failure names the file and the columns",
  describeFailedJob(conflicted.failed[0]).title,
  "GEO-2026-001 · Police v. Demo Defendant: Trial",
);

// --- drain order ----------------------------------------------------------

const order = [];
await flushOutbox(
  [
    {
      kind: "update",
      id: "evt-1",
      matterId: "mat-1",
      payload: { scheduled_date: "2026-11-03", event_status: "scheduled" },
      ...labels,
    },
    {
      kind: "matterPatch",
      id: matterPatchJobId("mat-1"),
      matterId: "mat-1",
      patch: { trial_status: "completed" },
      columns: ["trial_status"],
      ...labels,
    },
  ],
  {
    insertEvent: async () => ({ id: "real" }),
    updateEvent: async () => {
      order.push("hearing");
    },
    patchMatter: async () => {
      order.push("board");
    },
    pushGoogle: async () => ({ synced: true }),
  },
);
check("board changes drain before hearing updates", order, ["board", "hearing"]);

// --- a caller that cannot replay board patches keeps them queued ----------

const noSupport = await flushOutbox(
  [
    {
      kind: "matterPatch",
      id: matterPatchJobId("mat-1"),
      matterId: "mat-1",
      patch: { trial_status: "completed" },
      columns: ["trial_status"],
      ...labels,
    },
  ],
  {
    insertEvent: async () => ({ id: "x" }),
    updateEvent: async () => {},
    pushGoogle: async () => ({ synced: true }),
  },
);
check("without a patchMatter dep the job is kept, not dropped", noSupport.jobs.length, 1);
check("and not reported as failed", noSupport.failed.length, 0);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
