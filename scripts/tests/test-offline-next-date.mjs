/**
 * Queued next dates (B3).
 *
 * A next date is not a column write: set_docket_matter_next_date
 * supersedes whatever event currently drives next_appearance and applies
 * the magistrate's own capacity limit. That makes replay subtle, so the
 * rules are pinned here:
 *
 *  - one job per matter, LAST date wins. Replaying every intermediate
 *    date would create and cancel a chain of appearances the court never
 *    sat on, and supersede semantics exist to keep adjournment history
 *    honest;
 *  - the override is NEVER acknowledged on replay: that writes a capacity
 *    override row with a reason attributed to the magistrate, days after
 *    the fact. A full court comes back as its own failure reason;
 *  - next dates drain AFTER board changes, because the RPC stamps the new
 *    appearance's stage from the matter's current stage.
 *
 *   npm run test:offline-next-date
 */
import {
  describeFailedJob,
  enqueueNextDate,
  matterPatchJobId,
  nextDateJobId,
  pendingMatterIds,
  pendingNextDate,
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

let jobs = enqueueNextDate([], {
  matterId: "mat-1",
  scheduledDate: "2026-11-03",
  categoryId: "cat-1",
  ...labels,
});
jobs = enqueueNextDate(jobs, {
  matterId: "mat-1",
  scheduledDate: "2026-11-10",
  categoryId: "cat-1",
  ...labels,
});
check("changing your mind does not queue two dates", jobs.length, 1);
check("the last date wins", jobs[0].scheduledDate, "2026-11-10");
check("keyed by matter", jobs[0].id, nextDateJobId("mat-1"));

jobs = enqueueNextDate(jobs, {
  matterId: "mat-2",
  scheduledDate: "2026-12-01",
  categoryId: null,
  ...labels,
});
check("a different matter gets its own job", jobs.length, 2);
check("its queued date is findable", pendingNextDate(jobs, "mat-2").scheduledDate, "2026-12-01");
check("a matter with none returns null", pendingNextDate(jobs, "mat-9"), null);
check("both matters mark their row pending", [...pendingMatterIds(jobs)].sort(), [
  "mat-1",
  "mat-2",
]);

// --- replay ---------------------------------------------------------------

const calls = [];
const base = {
  insertEvent: async () => ({ id: "real" }),
  updateEvent: async () => {},
  patchMatter: async () => {},
  pushGoogle: async () => ({ synced: true }),
};
const ok = {
  ...base,
  setNextDate: async (matterId, scheduledDate, categoryId) => {
    calls.push({ matterId, scheduledDate, categoryId });
    return { status: "created" };
  },
};

const flushed = await flushOutbox(jobs, ok);
check("each matter's date is sent once", calls.length, 2);
check("only the final date is sent", calls[0].scheduledDate, "2026-11-10");
check("the queue drains empty", flushed.jobs.length, 0);
check("nothing dead-lettered on success", flushed.failed.length, 0);

// --- the court was already full when it synced ---------------------------

const full = await flushOutbox(
  [
    {
      kind: "nextDate",
      id: nextDateJobId("mat-1"),
      matterId: "mat-1",
      scheduledDate: "2026-11-10",
      categoryId: "cat-1",
      ...labels,
    },
  ],
  { ...base, setNextDate: async () => ({ status: "capacity_reached" }) },
);
check("a full court is its own reason, not a refusal", full.failed[0]?.reason, "capacity");
check("it does not stay queued to retry forever", full.jobs.length, 0);
check(
  "the message tells the magistrate how to proceed",
  full.failed[0].message.includes("Set it again to override"),
  true,
);
check(
  "the failure names the file and the date",
  describeFailedJob(full.failed[0]).title,
  "GEO-2026-001 · Police v. Demo Defendant: next date 2026-11-10",
);

// --- drain order ----------------------------------------------------------

const order = [];
await flushOutbox(
  [
    {
      kind: "nextDate",
      id: nextDateJobId("mat-1"),
      matterId: "mat-1",
      scheduledDate: "2026-11-10",
      categoryId: null,
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
    ...base,
    patchMatter: async () => {
      order.push("board");
    },
    setNextDate: async () => {
      order.push("nextDate");
      return { status: "created" };
    },
  },
);
check("board changes land before the next date is scheduled", order, ["board", "nextDate"]);

// --- a caller that cannot replay next dates keeps them queued ------------

const noSupport = await flushOutbox(
  [
    {
      kind: "nextDate",
      id: nextDateJobId("mat-1"),
      matterId: "mat-1",
      scheduledDate: "2026-11-10",
      categoryId: null,
      ...labels,
    },
  ],
  base,
);
check("without a setNextDate dep the job is kept", noSupport.jobs.length, 1);
check("and not reported as failed", noSupport.failed.length, 0);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
