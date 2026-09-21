/**
 * Judgment text kept on the device until the server has it.
 *
 * Pinned here, because each is silent when wrong:
 *
 *  - drafts are encrypted at rest, and a record moved to another judgment
 *    or profile, or tampered with, does not decrypt (it is dropped);
 *  - fingerprints ignore key order, so jsonb's reordering is not a conflict;
 *  - restore decisions: same text drops the draft, same base restores,
 *    moved base asks, a final judgment only offers copy or discard;
 *  - a replay whose updated_at guard misses is a conflict only when the
 *    CONTENT moved; a category change is retried against the new version;
 *  - a final judgment, a lost owner, a network drop and an expired session
 *    each classify differently, and none of them loses the text;
 *  - text typed while a save was in flight survives the save.
 *
 *   npm run test:judgment-drafts
 */
import {
  afterDraftSaved,
  contentFingerprint,
  createJudgmentDraftStore,
  decideDraftRestore,
  draftAfterFailedSave,
  MAX_DRAFT_ATTEMPTS,
  saveDraftContent,
  stableStringify,
} from "../../src/lib/offline/judgment-drafts.ts";

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
    get: async (key) => (map.has(key) ? map.get(key) : null),
    set: async (key, value) => void map.set(key, value),
    remove: async (key) => void map.delete(key),
    keys: async () => [...map.keys()],
  };
};

const doc = (text) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const draftOf = (overrides = {}) => ({
  judgmentId: "j-1",
  content: doc("My reasons"),
  contentText: "My reasons",
  baseFingerprint: "base",
  baseUpdatedAt: "2026-09-21T09:00:00Z",
  revision: 1,
  editedAt: "2026-09-21T09:05:00Z",
  queued: true,
  attempts: 0,
  problem: null,
  ...overrides,
});

// --- fingerprints ---------------------------------------------------------------

check(
  "stableStringify ignores key order",
  stableStringify({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }),
  stableStringify({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }),
);
check(
  "fingerprint of reordered jsonb equals the editor's",
  await contentFingerprint({ content: [], type: "doc" }),
  await contentFingerprint({ type: "doc", content: [] }),
);
check(
  "different text, different fingerprint",
  (await contentFingerprint(doc("a"))) === (await contentFingerprint(doc("b"))),
  false,
);
check(
  "without WebCrypto the fingerprint is the raw JSON",
  await contentFingerprint({ a: 1 }, null),
  'raw:{"a":1}',
);

// --- encrypted store --------------------------------------------------------------

{
  const kv = memoryKv();
  const store = createJudgmentDraftStore({ kv, crypto: globalThis.crypto });
  const kept = await store.save("p-1", draftOf());
  check("saved on the device", kept, "device");
  check("round trip", (await store.load("p-1", "j-1"))?.contentText, "My reasons");

  const raw = kv.map.get("jdraft:p-1:j-1");
  const plain = new TextDecoder().decode(new Uint8Array(raw.data));
  check("text is not stored in the clear", plain.includes("My reasons"), false);
  check("key is non-extractable", kv.map.get("jdraft-key:p-1").extractable, false);

  // A record copied under another judgment id must not restore there.
  kv.map.set("jdraft:p-1:j-2", raw);
  check("record moved to another judgment does not load", await store.load("p-1", "j-2"), null);
  check("and is dropped", kv.map.has("jdraft:p-1:j-2"), false);

  // Nor under another profile, even with that profile's own key present.
  await store.save("p-2", draftOf({ judgmentId: "j-9" }));
  kv.map.set("jdraft:p-2:j-1", raw);
  check("record moved to another profile does not load", await store.load("p-2", "j-1"), null);

  const tampered = new Uint8Array(raw.data.slice(0));
  tampered[0] ^= 1;
  kv.map.set("jdraft:p-1:j-1", { v: 1, iv: raw.iv, data: tampered.buffer });
  check("tampered record does not load", await store.load("p-1", "j-1"), null);

  await store.save("p-1", draftOf({ judgmentId: "j-3" }));
  await store.save("p-1", draftOf({ judgmentId: "j-4" }));
  check(
    "list returns only this profile's drafts",
    (await store.list("p-1")).map((d) => d.judgmentId).sort(),
    ["j-3", "j-4"],
  );

  await store.clearProfile("p-1");
  check(
    "sign-out clears drafts and the key",
    [...kv.map.keys()].filter((k) => k.includes("p-1")),
    [],
  );
  check("another profile is untouched", (await store.load("p-2", "j-9"))?.judgmentId, "j-9");

  // Saves are serialised: the last one written is the last one made.
  await Promise.all([
    store.save("p-3", draftOf({ revision: 1, contentText: "one" })),
    store.save("p-3", draftOf({ revision: 2, contentText: "two" })),
    store.save("p-3", draftOf({ revision: 3, contentText: "three" })),
  ]);
  check("rapid saves land in order", (await store.load("p-3", "j-1"))?.contentText, "three");
}

{
  const store = createJudgmentDraftStore({ kv: null, crypto: globalThis.crypto });
  check("no IndexedDB: held for this session only", await store.save("p-1", draftOf()), "session");
  check("and still loads", (await store.load("p-1", "j-1"))?.contentText, "My reasons");
}

{
  const kv = memoryKv();
  kv.set = async (key, value) => {
    if (key.startsWith("jdraft:")) {
      const error = new Error("full");
      error.name = "QuotaExceededError";
      throw error;
    }
    kv.map.set(key, value);
  };
  const store = createJudgmentDraftStore({ kv, crypto: globalThis.crypto });
  check("storage full: falls back to the session", await store.save("p-1", draftOf()), "session");
  check("and the text is still there", (await store.load("p-1", "j-1"))?.contentText, "My reasons");
}

// --- restore ------------------------------------------------------------------

const d = draftOf({ baseFingerprint: "v1" });
check("no draft", decideDraftRestore(null, { fingerprint: "v1", editable: true }, ""), "none");
check(
  "server already has this text",
  decideDraftRestore(d, { fingerprint: "mine", editable: true }, "mine"),
  "same",
);
check(
  "started from what is there: restore",
  decideDraftRestore(d, { fingerprint: "v1", editable: true }, "mine"),
  "restore",
);
check(
  "server moved on: ask",
  decideDraftRestore(d, { fingerprint: "v2", editable: true }, "mine"),
  "changed",
);
check(
  "final or not the owner's: copy or discard only",
  decideDraftRestore(d, { fingerprint: "v1", editable: false }, "mine"),
  "readOnly",
);
check(
  "a recorded conflict still asks",
  decideDraftRestore(
    { ...d, problem: { reason: "conflict", message: "x" } },
    { fingerprint: "v1", editable: true },
    "mine",
  ),
  "changed",
);

// --- after a save ---------------------------------------------------------------

check(
  "nothing typed meanwhile: draft removed",
  afterDraftSaved(draftOf({ revision: 5 }), draftOf({ revision: 5 }), {
    fingerprint: "f",
    updatedAt: "t",
  }),
  "remove",
);
{
  const kept = afterDraftSaved(
    draftOf({ revision: 7, contentText: "more" }),
    draftOf({ revision: 5 }),
    { fingerprint: "saved", updatedAt: "t2" },
  );
  check("typed meanwhile: newer text kept", kept.contentText, "more");
  check(
    "and re-based on the saved version",
    [kept.baseFingerprint, kept.baseUpdatedAt],
    ["saved", "t2"],
  );
  check("and not queued (it was never saved)", kept.queued, false);
}

// --- save / replay --------------------------------------------------------------

const fp = (content) => contentFingerprint(content);
const baseContent = doc("Original");
const baseFp = await fp(baseContent);
const mine = draftOf({ baseFingerprint: baseFp });

const deps = (over = {}) => {
  const calls = [];
  return {
    calls,
    fingerprint: fp,
    online: true,
    saveGuarded: async (...args) => {
      calls.push(args[3]);
      return { updatedAt: "t-new" };
    },
    fetchCurrent: async () => null,
    ...over,
  };
};

{
  const dep = deps();
  const out = await saveDraftContent(mine, "p-1", dep);
  check("clean save", out.kind, "saved");
  check("guarded on the base updated_at", dep.calls, ["2026-09-21T09:00:00Z"]);
}

{
  // Guard misses because the category changed; content is still the base.
  const calls = [];
  const out = await saveDraftContent(mine, "p-1", {
    ...deps(),
    saveGuarded: async (...args) => {
      calls.push(args[3]);
      return calls.length === 1 ? { conflict: true } : { updatedAt: "t-3" };
    },
    fetchCurrent: async () => ({
      content: { ...baseContent },
      updated_at: "t-2",
      status: "draft",
      owner_id: "p-1",
    }),
  });
  check("non-content change is not a conflict", out.kind, "saved");
  check("retried, still guarded, on the new version", calls, ["2026-09-21T09:00:00Z", "t-2"]);
}

{
  const out = await saveDraftContent(mine, "p-1", {
    ...deps({ saveGuarded: async () => ({ conflict: true }) }),
    fetchCurrent: async () => ({
      content: doc("Someone else's edit"),
      updated_at: "t-2",
      status: "draft",
      owner_id: "p-1",
    }),
  });
  check("content changed elsewhere: conflict", out.kind, "conflict");
}

{
  const out = await saveDraftContent(mine, "p-1", {
    ...deps({ saveGuarded: async () => ({ conflict: true }) }),
    fetchCurrent: async () => ({
      content: mine.content,
      updated_at: "t-2",
      status: "draft",
      owner_id: "p-1",
    }),
  });
  check("already saved (lost reply, second tab): saved", out.kind, "saved");
}

{
  const out = await saveDraftContent(mine, "p-1", {
    ...deps({ saveGuarded: async () => ({ conflict: true }) }),
    fetchCurrent: async () => ({
      content: baseContent,
      updated_at: "t-2",
      status: "final",
      owner_id: "p-1",
    }),
  });
  check("finalised meanwhile: refused, not conflict", out.kind, "refused");
}

{
  const out = await saveDraftContent(mine, "p-1", {
    ...deps({ saveGuarded: async () => ({ conflict: true }) }),
    fetchCurrent: async () => ({
      content: baseContent,
      updated_at: "t-2",
      status: "draft",
      owner_id: "someone-else",
    }),
  });
  check("not the owner: refused (no retry that RLS would drop)", out.kind, "refused");
}

{
  const out = await saveDraftContent(mine, "p-1", {
    ...deps({ saveGuarded: async () => ({ conflict: true }) }),
    fetchCurrent: async () => null,
  });
  check("no longer visible: refused", out.kind, "refused");
}

const throwing = (error, online = true) =>
  deps({
    online,
    saveGuarded: async () => {
      throw error;
    },
  });

check(
  "lifecycle trigger (P0001): refused",
  (await saveDraftContent(mine, "p-1", throwing({ code: "P0001", message: "final" }))).kind,
  "refused",
);
check(
  "network drop: offline, kept",
  (await saveDraftContent(mine, "p-1", throwing(new TypeError("Failed to fetch")))).kind,
  "offline",
);
check(
  "expired JWT: auth, kept",
  (await saveDraftContent(mine, "p-1", throwing({ code: "PGRST301", message: "JWT expired" })))
    .kind,
  "authExpired",
);
check(
  "unknown error: failed",
  (await saveDraftContent(mine, "p-1", throwing({ code: "XX000", message: "odd" }))).kind,
  "failed",
);

check("offline leaves the draft as it is", draftAfterFailedSave(mine, { kind: "offline" }), null);
check(
  "conflict stops the queue and records why",
  (({ queued, problem }) => [queued, problem.reason])(
    draftAfterFailedSave(mine, { kind: "conflict" }),
  ),
  [false, "conflict"],
);
check(
  "refused keeps the text, not the queue",
  (({ queued, contentText, problem }) => [queued, contentText, problem.reason])(
    draftAfterFailedSave(mine, { kind: "refused", message: "no" }),
  ),
  [false, "My reasons", "refused"],
);
{
  let draft = mine;
  for (let i = 0; i < MAX_DRAFT_ATTEMPTS; i += 1) {
    draft = draftAfterFailedSave(draft, { kind: "failed", message: "odd" });
  }
  check("unknown errors are bounded", [draft.queued, draft.problem?.reason], [false, "stalled"]);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
