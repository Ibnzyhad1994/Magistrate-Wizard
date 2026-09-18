/**
 * The offline store's move from whole-file localStorage blobs to
 * per-profile IndexedDB records (B1).
 *
 * Two things must hold, and both are the kind that fail silently:
 *
 *  1. An upgrade must not lose queued work. The pre-IndexedDB blobs are
 *     imported once, read-only, and the legacy keys are left in place for
 *     one release so a rollback still finds the queue.
 *  2. A write must touch only the profile it belongs to. The whole point
 *     is that queueing a hearing no longer re-serialises every cached
 *     matter on the device.
 *
 * Driven through `hydrateOfflineStore(adapter)` with a Map-backed
 * KvAdapter, so this needs no fake-IndexedDB dependency — the test
 * scripts are plain Node with no extra deps.
 *
 *   npm run test:offline-store-kv
 */
import {
  clearOfflineForProfile,
  getFailedJobs,
  getOutboxJobs,
  getProfileCache,
  hydrateOfflineStore,
  setOutboxJobs,
  setProfileCache,
} from "../../src/lib/offline/store.ts";
import { saveDeviceJson } from "../../src/lib/device-storage.ts";

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

/** A KvAdapter backed by a Map, plus a log of every key written. */
const makeKv = () => {
  const map = new Map();
  const writes = [];
  return {
    map,
    writes,
    adapter: {
      get: async (key) => (map.has(key) ? structuredClone(map.get(key)) : null),
      set: async (key, value) => {
        writes.push(key);
        map.set(key, structuredClone(value));
      },
      remove: async (key) => {
        writes.push(`remove:${key}`);
        map.delete(key);
      },
      keys: async () => [...map.keys()],
    },
  };
};

const PROFILE_A = "profile-a";
const PROFILE_B = "profile-b";

const job = (id) => ({
  kind: "update",
  id,
  matterId: "mat-1",
  payload: {
    scheduled_date: "2026-11-03",
    scheduled_time: null,
    event_type: "mention",
    location: null,
    stage_at_event: null,
    outcome_at_event: null,
    orders_made_at_event: null,
    notes: null,
    event_status: "scheduled",
  },
  caseNumber: "GEO-2026-001",
  matterTitle: "Police v. Demo Defendant",
});

// --- 1. an upgrade imports the legacy blobs exactly once ------------------

await saveDeviceJson("mw.offline-outbox.v1", { [PROFILE_A]: [job("evt-legacy")] });
await saveDeviceJson("mw.offline-failed.v1", {
  [PROFILE_A]: [{ job: job("evt-dead"), reason: "dropped", message: "no", failedAt: "2026-01-01" }],
});
await saveDeviceJson("mw.offline-docket-cache.v1", { [PROFILE_A]: { matters: {}, hearings: {} } });
await saveDeviceJson("mw.offline-profile.v1", { [PROFILE_A]: { id: PROFILE_A, email: "a@b.c" } });

const first = makeKv();
await hydrateOfflineStore(first.adapter);

check("queued work survives the upgrade", getOutboxJobs(PROFILE_A).length, 1);
check("the queued job is the same one", getOutboxJobs(PROFILE_A)[0].id, "evt-legacy");
check("the dead-letter list survives too", getFailedJobs(PROFILE_A).length, 1);
check("each slice is written under its own key", [...first.map.keys()].sort(), [
  "cache:profile-a",
  "failed:profile-a",
  "mw.kv-migrated.v1",
  "outbox:profile-a",
  "profiles:profile-a",
]);

// The legacy blob must still be readable, so a rollback to the previous
// release does not find an empty queue.
const { loadDeviceJson } = await import("../../src/lib/device-storage.ts");
const legacyStillThere = await loadDeviceJson("mw.offline-outbox.v1");
check("the legacy blob is left in place for one release", Boolean(legacyStillThere), true);

// --- 2. a second hydrate reads records, and does not re-import -----------

const second = makeKv();
for (const [key, value] of first.map) second.map.set(key, structuredClone(value));
second.writes.length = 0;
await hydrateOfflineStore(second.adapter);
check("a later start reads the records back", getOutboxJobs(PROFILE_A)[0].id, "evt-legacy");
check("and does not re-import the legacy blobs", second.writes.length, 0);

// --- 3. a write touches only its own profile's slice --------------------

second.writes.length = 0;
await setOutboxJobs(PROFILE_B, [job("evt-b")]);
check("queueing for one profile writes one key", second.writes, ["outbox:profile-b"]);
check("the other profile's queue is untouched", getOutboxJobs(PROFILE_A)[0].id, "evt-legacy");

second.writes.length = 0;
await setProfileCache(PROFILE_A, { matters: { "mat-1": { id: "mat-1" } }, hearings: {} });
check("caching a matter does not rewrite the outbox", second.writes, ["cache:profile-a"]);
check(
  "the cache is readable after the write",
  Object.keys(getProfileCache(PROFILE_A).matters ?? {}),
  ["mat-1"],
);

// --- 4. sign-out removes that profile's records, not everyone's ---------

second.writes.length = 0;
await clearOfflineForProfile(PROFILE_A);
check(
  "a full sign-out removes every slice for that profile",
  second.writes.filter((w) => w.startsWith("remove:")).sort(),
  [
    "remove:cache:profile-a",
    "remove:failed:profile-a",
    "remove:outbox:profile-a",
    "remove:profiles:profile-a",
  ],
);
check("the other profile's queue survives", getOutboxJobs(PROFILE_B).length, 1);

// --- 5. a lock keeps the queue but drops cached case data ---------------

await setProfileCache(PROFILE_B, { matters: { "mat-9": { id: "mat-9" } }, hearings: {} });
second.writes.length = 0;
const { clearOfflineCacheForProfile } = await import("../../src/lib/offline/store.ts");
await clearOfflineCacheForProfile(PROFILE_B);
check("locking keeps the queued work", getOutboxJobs(PROFILE_B).length, 1);
check("locking clears cached case data", Object.keys(getProfileCache(PROFILE_B).matters ?? {}), []);
check(
  "and never removes the outbox record",
  second.writes.includes("remove:outbox:profile-b"),
  false,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
