/**
 * Queued work syncs on its own (U-02).
 *
 * A hearing saved while a write failed used to wait for a manual "Sync
 * pending": the only triggers were the browser `online` event, the tab
 * becoming visible and the native network change, and none of them fires
 * when the browser stayed "online" through a server blip or a flaky link.
 * Not after the link recovered, not after a reload, not after signing in.
 *
 * Two layers:
 *  1. The scheduler (auto-sync.ts) with fake timers: backoff, the stop when
 *     the queue empties, one run at a time, background vs explicit passes.
 *  2. The real runtime (runtime.ts) over a programmable Supabase stub and
 *     mocked setTimeout: start, sign-in, `online`, visibility and the
 *     backoff retry each flush, and a background retry never uses up one of
 *     a job's bounded attempts.
 *
 *   npm run test:offline-auto-sync
 */
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import {
  AUTO_SYNC_BASE_DELAY_MS,
  AUTO_SYNC_MAX_DELAY_MS,
  autoSyncDelay,
  createAutoSync,
} from "@/lib/offline/auto-sync";
import { flushOutbox } from "@/lib/offline/flush";
import { MAX_UNCLASSIFIED_ATTEMPTS } from "@/lib/offline/outbox";
import { draftAfterFailedSave, MAX_DRAFT_ATTEMPTS } from "@/lib/offline/judgment-drafts";
import { getOutboxJobs, hydrateOfflineStore, setOutboxJobs } from "@/lib/offline/store";
import { startOfflineFlushListeners, syncOfflineWorkNow } from "@/lib/offline/runtime";
import { useAuthStore } from "@/store/auth-store";
import { installSupabaseFromMock } from "../test-support/supabase-stub.mjs";

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

/** Lets queued promise callbacks run (setImmediate is left unmocked). */
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const fakeTimers = () => {
  let nextId = 1;
  const pending = new Map();
  return {
    pending,
    timers: {
      set: (run, ms) => {
        const id = nextId++;
        pending.set(id, { run, ms });
        return id;
      },
      clear: (id) => pending.delete(id),
    },
    /** Fires the one pending timer; returns the delay it was set with. */
    fire: () => {
      const [[id, timer]] = [...pending];
      pending.delete(id);
      timer.run();
      return timer.ms;
    },
  };
};

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

// --- 1. the scheduler ------------------------------------------------------------

check(
  "backoff doubles from the base and is capped",
  [0, 1, 2, 3, 10].map((n) => autoSyncDelay(n, () => 1)),
  [5_000, 10_000, 20_000, 40_000, AUTO_SYNC_MAX_DELAY_MS],
);
check(
  "jitter scales each delay into 50-100%",
  [autoSyncDelay(0, () => 0), autoSyncDelay(0, () => 0.5)],
  [AUTO_SYNC_BASE_DELAY_MS / 2, AUTO_SYNC_BASE_DELAY_MS * 0.75],
);

{
  // A queue that will not drain until `drainOn` passes have run.
  const clock = fakeTimers();
  let queued = 1;
  const passes = [];
  let drainOn = Infinity;
  const sync = createAutoSync({
    flush: async ({ background }) => {
      passes.push(background);
      if (passes.length >= drainOn) queued = 0;
    },
    hasPending: () => queued > 0,
    isOffline: () => false,
    timers: clock.timers,
    random: () => 1,
  });

  await sync.flushNow();
  check("an explicit flush is not a background pass", passes, [false]);
  check("work still queued: one retry is set", clock.pending.size, 1);
  check("the first retry waits the base delay", sync.pendingRetryDelayMs(), 5_000);

  const delays = [];
  for (let i = 0; i < 8; i += 1) {
    delays.push(clock.fire());
    await settle();
  }
  check(
    "each retry backs off further, up to the cap",
    delays,
    [5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000],
  );
  check("timer retries are background passes", passes.slice(1), Array(8).fill(true));

  drainOn = passes.length + 1;
  clock.fire();
  await settle();
  check("once the queue is empty no retry is set", clock.pending.size, 0);
  check("and nothing reports a pending retry", sync.pendingRetryDelayMs(), null);

  queued = 1;
  sync.schedule();
  check("new work starts the timer again", clock.pending.size, 1);
  check("from the base delay, not the old backoff", sync.pendingRetryDelayMs(), 5_000);
  sync.schedule();
  check("a second schedule does not add a second timer", clock.pending.size, 1);
}

{
  const clock = fakeTimers();
  const sync = createAutoSync({
    flush: async () => {},
    hasPending: () => false,
    isOffline: () => false,
    timers: clock.timers,
  });
  sync.schedule();
  check("nothing queued: no timer", clock.pending.size, 0);
}

{
  const clock = fakeTimers();
  const sync = createAutoSync({
    flush: async () => {},
    hasPending: () => true,
    isOffline: () => true,
    timers: clock.timers,
  });
  sync.schedule();
  check("known offline: no timer, the online event will flush", clock.pending.size, 0);
}

{
  // One run at a time. Requests during a run fold into ONE more pass, and
  // an explicit request makes that pass explicit even if the run was a
  // background one.
  const clock = fakeTimers();
  let inFlight = 0;
  let maxInFlight = 0;
  const passes = [];
  const gates = [];
  let queued = 1;
  const sync = createAutoSync({
    flush: async ({ background }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      passes.push(background);
      const gate = deferred();
      gates.push(gate);
      await gate.promise;
      inFlight -= 1;
    },
    hasPending: () => queued > 0,
    isOffline: () => false,
    timers: clock.timers,
    random: () => 1,
  });

  sync.schedule();
  clock.fire(); // background run starts
  await settle();
  let firstDone = false;
  let secondDone = false;
  const a = sync.flushNow().then(() => {
    firstDone = true;
  });
  const b = sync.flushNow().then(() => {
    secondDone = true;
  });
  sync.flushNow();
  await settle();
  check("only the first run is in flight", [inFlight, passes.length], [1, 1]);
  gates[0].resolve();
  await settle();
  check("the folded requests run as one more pass", passes.length, 2);
  check("Sync now does not resolve on the run it did not start", firstDone, false);
  queued = 0;
  gates[1].resolve();
  await Promise.all([a, b]);
  check("both callers resolve after that pass", [firstDone, secondDone], [true, true]);
  check("never two flushes at once", maxInFlight, 1);
  check("the folded pass is explicit (it counts attempts)", passes, [true, false]);
  check("the queue drained: no retry left", clock.pending.size, 0);
}

{
  // A flush that throws must not stop the retries.
  const clock = fakeTimers();
  const sync = createAutoSync({
    flush: async () => {
      throw new Error("boom");
    },
    hasPending: () => true,
    isOffline: () => false,
    timers: clock.timers,
  });
  await sync.flushNow();
  check("a thrown flush still schedules the retry", clock.pending.size, 1);
}

// --- 2. background retries keep the attempt budget ------------------------------

const patchJob = (attempts) => ({
  kind: "matterPatch",
  id: "matter:mat-1",
  matterId: "mat-1",
  patch: { current_stage: "trial" },
  caseNumber: "GEO-2026-001",
  matterTitle: "Police v. Demo Defendant",
  baseUpdatedAt: null,
  ...(attempts === undefined ? {} : { attempts }),
});
const unclassified = {
  patchMatter: async () => {
    throw { code: "XX999", message: "internal error" };
  },
  insertEvent: async () => ({ id: "x" }),
  updateEvent: async () => {},
  pushGoogle: async () => ({ synced: true }),
};

{
  const atBound = await flushOutbox([patchJob(MAX_UNCLASSIFIED_ATTEMPTS - 1)], unclassified, {
    countAttempts: false,
  });
  check("a background retry never sets a job aside", atBound.failed.length, 0);
  check("the job stays queued", atBound.jobs.length, 1);
  check("with its attempts unchanged", atBound.jobs[0].attempts, MAX_UNCLASSIFIED_ATTEMPTS - 1);
  check("the drain still stops behind it", atBound.stopped, true);

  const explicit = await flushOutbox([patchJob(MAX_UNCLASSIFIED_ATTEMPTS - 1)], unclassified);
  check("an explicit flush still sets it aside at the bound", explicit.failed.length, 1);
}

{
  const draft = {
    judgmentId: "j-1",
    content: {},
    contentText: "",
    baseFingerprint: "f",
    baseUpdatedAt: null,
    revision: 1,
    editedAt: "2026-10-20T09:00:00Z",
    queued: true,
    attempts: MAX_DRAFT_ATTEMPTS - 1,
  };
  const failed = { kind: "failed", message: "internal error" };
  check(
    "a background judgment retry leaves the draft as it is",
    draftAfterFailedSave(draft, failed, { countAttempts: false }),
    null,
  );
  check(
    "an explicit one still marks it stalled at the bound",
    draftAfterFailedSave(draft, failed)?.problem?.reason,
    "stalled",
  );
}

// --- 3. the runtime's triggers ------------------------------------------------------

// The listeners attach to window and document; plain Node has neither.
globalThis.window = new EventTarget();
globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });
mock.timers.enable({ apis: ["setTimeout"] });

// The link: `down` fails every write at the network layer, the way the
// audit's repro aborted the docket requests with the browser still online.
let linkDown = true;
let writes = 0;
installSupabaseFromMock(() => {
  const builder = {
    update: () => builder,
    eq: () => builder,
    select: async () => {
      writes += 1;
      if (linkDown) throw new TypeError("Failed to fetch");
      return { data: [{ id: "mat-1" }], error: null };
    },
  };
  return builder;
});

const memoryKv = () => {
  const map = new Map();
  return {
    get: async (key) => (map.has(key) ? structuredClone(map.get(key)) : null),
    set: async (key, value) => {
      map.set(key, structuredClone(value));
    },
    remove: async (key) => {
      map.delete(key);
    },
    keys: async () => [...map.keys()],
  };
};

const PROFILE = "user-a";
const signIn = () =>
  useAuthStore.setState({
    status: "authenticated",
    session: { access_token: "jwt", user: { id: PROFILE } },
    user: { id: PROFILE, email: "m1@example.test" },
  });

await hydrateOfflineStore(memoryKv());
signIn();
// A board change saved while the write failed: it sits in the outbox.
await setOutboxJobs(PROFILE, [patchJob()]);

startOfflineFlushListeners();
await settle();
check("app start flushes work left from before the reload", writes, 1);
check("an explicit start flush counts the failed attempt", getOutboxJobs(PROFILE)[0]?.attempts, 1);

mock.timers.tick(AUTO_SYNC_BASE_DELAY_MS);
await settle();
check("the backoff retry fires with the browser still online", writes, 2);
check("a background retry keeps the attempt count", getOutboxJobs(PROFILE)[0]?.attempts, 1);

// The link recovers: the next retry sends it, with no click.
linkDown = false;
mock.timers.tick(2 * AUTO_SYNC_BASE_DELAY_MS);
await settle();
check("after the link recovers the retry sends it", writes, 3);
check("the outbox is empty", getOutboxJobs(PROFILE).length, 0);
mock.timers.tick(AUTO_SYNC_MAX_DELAY_MS * 4);
await settle();
check("an empty queue stops the retries", writes, 3);

// Something newly queued while online starts the timer by itself.
linkDown = true;
await setOutboxJobs(PROFILE, [patchJob()]);
mock.timers.tick(AUTO_SYNC_BASE_DELAY_MS);
await settle();
check("newly queued work is retried without any event", writes, 4);

// Signing out and back in flushes at sign-in.
useAuthStore.getState().clearForSignOut();
await settle();
const beforeSignIn = writes;
signIn();
await settle();
check("sign-in flushes queued work", writes, beforeSignIn + 1);

// The existing triggers still flush.
const beforeOnline = writes;
window.dispatchEvent(new Event("online"));
await settle();
check("the online event still flushes", writes, beforeOnline + 1);
document.dispatchEvent(new Event("visibilitychange"));
await settle();
check("the tab becoming visible still flushes", writes, beforeOnline + 2);

// Locked: nothing can be sent until the password is entered, so the timer
// stops rather than retrying into a dropped session.
useAuthStore.setState({ status: "locked", session: null });
await settle();
const beforeLock = writes;
mock.timers.tick(AUTO_SYNC_MAX_DELAY_MS * 4);
await settle();
check("no retries while the session is locked", writes, beforeLock);

// Unlocking flushes again, and Sync now waits for a full pass.
linkDown = false;
signIn();
await settle();
check("unlocking flushes the work kept through the lock", getOutboxJobs(PROFILE).length, 0);
await setOutboxJobs(PROFILE, [patchJob()]);
await syncOfflineWorkNow();
check("Sync now resolves once its own pass has sent the work", getOutboxJobs(PROFILE).length, 0);

// The copy stops promising "when online": the browser was online all along.
const banner = readFileSync("src/components/layout/offline-sync-banner.tsx", "utf8");
check("banner says not yet synced", banner.includes("Saved on this device, not yet synced."), true);
const stillOnline = [
  "src/components/layout/offline-sync-banner.tsx",
  "src/pages/docket/docket-stage-sheet.tsx",
  "src/hooks/docket/use-docket-capacity.ts",
  "src/hooks/judgments/use-judgment-draft.ts",
  "src/lib/offline/runtime.ts",
].filter((file) => /when (you are back )?online/i.test(readFileSync(file, "utf8")));
check("no queued-save copy says it waits to be online", stillOnline, []);
check(
  "the banner's Sync button goes through the shared entry point",
  banner.includes("syncOfflineWorkNow"),
  true,
);

mock.timers.reset();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
