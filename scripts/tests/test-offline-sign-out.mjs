/**
 * Signing out never deletes unsynced work without consent (U-01).
 *
 * Sign-out wipes this profile's outbox, failed list and judgment drafts
 * from the device. It used to do that silently, and fire-and-forget, so a
 * hearing saved on a flaky link vanished at the end of the day, or did not,
 * depending on how fast the next sign-in was.
 *
 * Covered here: the pending-count check, each path out of the dialog
 * (nothing pending, Sync now that empties the queue, Sync now that falls
 * short, Sign out and discard), the awaited wipe, a flush in flight during
 * the wipe, and that every sign-out control goes through the guard.
 *
 *   npm run test:offline-sign-out
 */
import { readFileSync } from "node:fs";
import {
  clearDeviceWorkForProfile,
  decideSignOut,
  describeUnsyncedWork,
  hasSyncableWork,
  readUnsyncedWork,
  syncThenDecide,
  unsyncedSummary,
  unsyncedTotal,
} from "@/lib/offline/sign-out-guard";
import {
  appendFailedJobs,
  getFailedJobs,
  getOutboxJobs,
  hydrateOfflineStore,
  setOutboxJobs,
} from "@/lib/offline/store";
import { saveJudgmentDraft } from "@/lib/offline/judgment-drafts-runtime";
import { flushPendingHearings } from "@/lib/offline/runtime";
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

const memoryKv = () => {
  const map = new Map();
  return {
    map,
    adapter: {
      get: async (key) => (map.has(key) ? structuredClone(map.get(key)) : null),
      set: async (key, value) => {
        map.set(key, structuredClone(value));
      },
      remove: async (key) => {
        map.delete(key);
      },
      keys: async () => [...map.keys()],
    },
  };
};

const PROFILE = "user-a";
const OTHER = "user-b";
useAuthStore.setState({
  status: "authenticated",
  session: { access_token: "jwt", user: { id: PROFILE } },
  user: { id: PROFILE, email: "m1@example.test" },
});

const kv = memoryKv();
await hydrateOfflineStore(kv.adapter);

const hearing = (id) => ({
  kind: "create",
  id: `local:${id}`,
  matterId: "mat-1",
  payload: {
    scheduled_date: "2026-10-20",
    scheduled_time: null,
    event_type: "mention",
    location: null,
    stage_at_event: null,
    outcome_at_event: null,
    orders_made_at_event: null,
    notes: null,
    event_status: "held",
  },
  caseNumber: "GEO-2026-001",
  matterTitle: "Police v. Double Click",
});
const draft = (judgmentId, extra) => ({
  judgmentId,
  content: { type: "doc" },
  contentText: "Text",
  baseFingerprint: "f",
  baseUpdatedAt: null,
  revision: 1,
  editedAt: "2026-10-20T09:00:00Z",
  queued: true,
  ...extra,
});

// --- nothing pending: sign straight out --------------------------------------------

const none = await readUnsyncedWork(PROFILE);
check("a clean device has nothing unsynced", unsyncedTotal(none), 0);
check("so sign-out goes straight through", await decideSignOut(PROFILE), { kind: "signOut" });
check("no user: nothing of anyone's to protect", await decideSignOut(undefined), {
  kind: "signOut",
});

// --- pending work: ask ---------------------------------------------------------------

await setOutboxJobs(PROFILE, [hearing("1")]);
const oneHearing = await decideSignOut(PROFILE);
check("one queued hearing opens the dialog", oneHearing.kind, "ask");
check("the dialog has not tried a sync yet", oneHearing.syncFellShort, false);
check(
  "its summary is plain and singular",
  unsyncedSummary(oneHearing.work),
  "1 save on this device has not reached the server. Signing out deletes it.",
);

await setOutboxJobs(PROFILE, [hearing("1"), hearing("2")]);
await appendFailedJobs(PROFILE, [
  { job: hearing("3"), reason: "dropped", message: "refused", failedAt: "2026-10-20T09:00:00Z" },
]);
await saveJudgmentDraft(draft("j-queued"));
await saveJudgmentDraft(
  draft("j-problem", { queued: false, problem: { reason: "conflict", message: "x" } }),
);
// Typing never saved is not "unsynced saves": only queued or problem drafts count.
await saveJudgmentDraft(draft("j-typing", { queued: false }));

const all = await readUnsyncedWork(PROFILE);
check("hearings, the failed list and judgment drafts all count", all, {
  docketWaiting: 2,
  docketNotApplied: 1,
  judgmentsWaiting: 1,
  judgmentsNeedChoice: 1,
});
check("five saves at risk", unsyncedTotal(all), 5);
check("the dialog lists each kind", describeUnsyncedWork(all), [
  "2 docket changes waiting to sync",
  "1 docket change the server did not accept",
  "1 judgment waiting to sync",
  "1 judgment needing you to choose what to keep",
]);
check(
  "plural summary",
  unsyncedSummary(all),
  "5 saves on this device have not reached the server. Signing out deletes them.",
);
check("Sync now is offered when something can be sent", hasSyncableWork(all), true);
check(
  "Sync now is not offered for work only a person can resolve",
  hasSyncableWork({
    docketWaiting: 0,
    docketNotApplied: 1,
    judgmentsWaiting: 0,
    judgmentsNeedChoice: 1,
  }),
  false,
);
check("another profile's work is not counted", unsyncedTotal(await readUnsyncedWork(OTHER)), 0);

// --- Sync now ---------------------------------------------------------------------------

{
  let synced = 0;
  const left = {
    docketWaiting: 0,
    docketNotApplied: 0,
    judgmentsWaiting: 0,
    judgmentsNeedChoice: 0,
  };
  const step = await syncThenDecide(PROFILE, {
    sync: async () => {
      synced += 1;
    },
    read: async () => left,
  });
  check("Sync now flushes first", synced, 1);
  check("and signs out once nothing is left", step, { kind: "signOut" });
}
{
  const left = {
    docketWaiting: 1,
    docketNotApplied: 0,
    judgmentsWaiting: 0,
    judgmentsNeedChoice: 0,
  };
  const step = await syncThenDecide(PROFILE, { sync: async () => {}, read: async () => left });
  check("Sync now that falls short keeps the dialog open", step.kind, "ask");
  check("and says so", step.syncFellShort, true);
  check("with what is still left", step.work, left);
}
{
  // The real path, on a link that is still down: nothing is lost.
  installSupabaseFromMock(() => {
    throw new TypeError("Failed to fetch");
  });
  const step = await syncThenDecide(PROFILE);
  check("a real Sync now on a dead link does not sign out", step.kind, "ask");
  check("the queued hearings are still there", getOutboxJobs(PROFILE).length, 2);
}

// --- Sign out and discard: the awaited wipe -------------------------------------------

check("the outbox is on disk before the wipe", kv.map.has(`outbox:${PROFILE}`), true);
await clearDeviceWorkForProfile(PROFILE);
check("once the wipe resolves the outbox record is gone", kv.map.has(`outbox:${PROFILE}`), false);
check("the failed list record is gone", kv.map.has(`failed:${PROFILE}`), false);
check("and nothing unsynced is left", unsyncedTotal(await readUnsyncedWork(PROFILE)), 0);

// --- a flush in flight while the person signs out --------------------------------------

{
  await setOutboxJobs(PROFILE, [hearing("4")]);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  installSupabaseFromMock(() => {
    const builder = {
      insert: () => builder,
      select: () => builder,
      single: async () => {
        await held;
        throw new TypeError("Failed to fetch");
      },
    };
    return builder;
  });
  const inFlight = flushPendingHearings();
  await new Promise((resolve) => setImmediate(resolve));
  await clearDeviceWorkForProfile(PROFILE);
  release();
  await inFlight;
  check("a flush finishing after the wipe does not restore the outbox", getOutboxJobs(PROFILE), []);
  check("nor write it back to disk", kv.map.has(`outbox:${PROFILE}`), false);
  check("nor restore a failed list", getFailedJobs(PROFILE), []);
}

// --- every sign-out control goes through the guard -------------------------------------

const read = (file) => readFileSync(file, "utf8");
const useAuth = read("src/hooks/use-auth.ts");
check(
  "the wipe is no longer fire-and-forget",
  /void clear(Offline|JudgmentDrafts)ForProfile/.test(useAuth),
  false,
);
const mutation = useAuth.slice(useAuth.indexOf('mutationKey: ["auth", "signOut"]'));
const awaitAt = mutation.indexOf("await clearDeviceWorkForProfile(profileId)");
check("sign-out awaits the wipe", awaitAt > -1, true);
check(
  "before leaving the page, so the next sign-in cannot race it",
  awaitAt < mutation.indexOf("clearForSignOut()"),
  true,
);

for (const file of [
  "src/components/layout/user-menu.tsx",
  "src/components/auth/session-lock-dialog.tsx",
]) {
  const source = read(file);
  check(`${file} signs out through the guard`, source.includes("requestSignOut()"), true);
  check(`${file} never calls the bare sign-out`, /\bsignOut\(\)/.test(source), false);
  check(
    `${file} renders the unsynced-work dialog`,
    source.includes("<UnsyncedSignOutDialog"),
    true,
  );
}

const dialog = read("src/components/auth/unsynced-sign-out-dialog.tsx");
check("the dialog offers Sync now", dialog.includes("Sync now"), true);
check(
  "discarding is an explicit, destructive choice",
  /variant="destructive"[^>]*>[\s\S]{0,120}Sign out and discard/.test(dialog),
  true,
);
check(
  "built on the app's dialog primitive",
  dialog.includes('from "@/components/ui/dialog"'),
  true,
);
check("stacks above the lock dialog when opened from it", dialog.includes("z-lock"), true);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
