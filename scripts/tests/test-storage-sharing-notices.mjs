// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * Storage, sharing and notifications (0165), on a real database with the
 * storage-cleanup Edge Function served.
 *
 * Replays the 2026-10-15 audit's theme T6 repros through the same clients
 * the app and an attacker would use, each with a control proving the
 * legitimate flow still works:
 *
 *   C-04  a `documents` row can point only into its uploader's own folder,
 *         so a revoked recipient cannot claim a deleted file; deleting a
 *         judgment, bench note, quick code, Case Law entry or docket
 *         matter queues its files and the storage-cleanup function removes
 *         them, including a preview derivative in another viewer's folder;
 *         a missed cleanup run leaves the path queued, never lost.
 *   C-09  Judgments and research are never shared with a clerk or a
 *         magistrate without a court, and the "finalised" notice reaches
 *         only recipients who can read the judgment.
 *   B-13  revoke-then-share-again (a level change) is announced; other
 *         notices are still deduplicated.
 *   B-16  a revoke is stamped with the server's clock, whatever the device
 *         sends.
 *   B-15  case numbers stay unique across a Magisterial District (ADR
 *         0009): a collision is refused with the plain sentence and never
 *         shows the other court's matter.
 *   C-11  a bench note can only be pointed at a parent its author can see,
 *         and an existing note survives losing access to its parent.
 *
 * Creates its own districts, courts, users and rows (all carrying the
 * fixture mark) and removes them afterwards, pass or fail. audit_log is
 * append-only and hash-chained, so a fixture user who wrote an audited row
 * cannot be deleted; those accounts are deactivated instead.
 *
 *   npm run db:start && npm run test:storage-sharing-notices
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";
import { deleteThenCleanStorage, requestStorageCleanup } from "@/lib/storage-cleanup";
import { getErrorMessage } from "@/lib/utils";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-storage-sharing-notices");
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}
const must = ({ data, error }, label) => {
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
};
const errorCode = ({ error }) => error?.code ?? null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(URL, SERVICE, noSession);
const MARK = `T6-FIX-${Date.now() % 1_000_000}`;
const PASSWORD = "T6-fixture-pass-123!";
const email = (name) => `${MARK.toLowerCase()}-${name}@example.test`;
const NOT_FOUND_NOTE = (type) => `bench_notes.entity_id does not reference an existing ${type} row`;
const RESEARCH_SHARE_REFUSED =
  "Judgments and research can be shared only with a magistrate who sits a court, or an administrator. Clerks cannot open them.";

const created = {
  users: [],
  courts: [],
  districts: [],
  judgments: [],
  caseLaw: [],
  quickCodes: [],
  benchNotes: [],
  statutes: [],
  matters: [],
  objects: [],
};

async function createUser(name, meta = {}) {
  const user = must(
    await admin.auth.admin.createUser({
      email: email(name),
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `${MARK} ${name}`, ...meta },
    }),
    `create ${name}`,
  ).user;
  created.users.push(user.id);
  return user;
}

async function signIn(user) {
  const client = createClient(URL, ANON, noSession);
  must(await client.auth.signInWithPassword({ email: user.email, password: PASSWORD }), "sign in");
  return client;
}

async function seat(profileId, courtId) {
  must(
    await admin.from("magistrate_courts").insert({ profile_id: profileId, court_id: courtId }),
    "seat magistrate",
  );
}

async function unseat(profileId) {
  must(
    await admin
      .from("magistrate_courts")
      .update({ ended_at: new Date().toISOString() })
      .eq("profile_id", profileId)
      .is("ended_at", null),
    "end sitting",
  );
}

/** The same two calls uploadDocumentToEntity makes, as the given user. */
async function attach(client, uid, entityType, entityId, text, extra = {}) {
  const path = `${uid}/${entityType}/${entityId}/${Date.now()}-${MARK}.txt`;
  must(
    await client.storage.from("documents").upload(path, new Blob([text], { type: "text/plain" }), {
      contentType: "text/plain",
      upsert: false,
    }),
    `upload to ${entityType}`,
  );
  created.objects.push(path);
  return must(
    await client
      .from("documents")
      .insert({
        uploaded_by: uid,
        file_name: `${MARK}.txt`,
        file_path: path,
        file_size: text.length,
        mime_type: "text/plain",
        entity_type: entityType,
        entity_id: entityId,
        ...extra,
      })
      .select("id, file_path")
      .single(),
    `documents row on ${entityType}`,
  );
}

async function readText(client, path) {
  const { data, error } = await client.storage.from("documents").download(path);
  return error || !data ? null : await data.text();
}

const stored = async (path) => (await readText(admin, path)) !== null;

async function queued(paths) {
  const { data } = await admin
    .from("storage_cleanup_queue")
    .select("object_name")
    .in("object_name", paths);
  return (data ?? []).map((row) => row.object_name).sort();
}

/** The hooks request cleanup without awaiting it; wait for the queue to drain. */
async function waitUntilDrained(paths) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if ((await queued(paths)).length === 0) return true;
    await sleep(250);
  }
  return false;
}

async function noticesFor(client, link) {
  const { data } = await client
    .from("notifications")
    .select("type, title, body")
    .eq("link", link)
    .order("created_at", { ascending: true });
  return data ?? [];
}

async function main() {
  // ---------- fixtures ----------
  const district = async (suffix) => {
    const row = must(
      await admin
        .from("magisterial_districts")
        .insert({ name: `${MARK} ${suffix}` })
        .select()
        .single(),
      `district ${suffix}`,
    );
    created.districts.push(row.id);
    return row.id;
  };
  const court = async (districtId, suffix) => {
    const row = must(
      await admin
        .from("courts")
        .insert({
          name: `${MARK} ${suffix}`,
          jurisdiction: "Test",
          district_id: districtId,
          is_active: true,
        })
        .select()
        .single(),
      `court ${suffix}`,
    );
    created.courts.push(row.id);
    return row.id;
  };
  const districtD = await district("District D");
  const districtE = await district("District E");
  const courtA = await court(districtD, "Court A");
  const courtB = await court(districtD, "Court B");
  const courtC = await court(districtE, "Court C");

  const m1 = await createUser("m1");
  const m2 = await createUser("m2");
  const m3 = await createUser("m3");
  const m4 = await createUser("m4-no-court");
  const m5 = await createUser("m5");
  const clerk = await createUser("clerk", { requested_role: "clerk" });
  const curator = await createUser("curator");
  must(await admin.from("profiles").update({ role: "admin" }).eq("id", curator.id), "make admin");
  await seat(m1.id, courtA);
  await seat(m2.id, courtA);
  await seat(m3.id, courtB);
  await seat(m5.id, courtC);

  const c1 = await signIn(m1);
  const c2 = await signIn(m2);
  const c3 = await signIn(m3);
  const c5 = await signIn(m5);
  const cCurator = await signIn(curator);

  const newJudgment = async (client, title) => {
    const row = must(
      await client.from("judgments").insert({ title, status: "draft" }).select("id").single(),
      `judgment ${title}`,
    );
    created.judgments.push(row.id);
    return row.id;
  };
  const share = async (client, itemType, itemId, recipientId, permission) =>
    client
      .from("shares")
      .insert({ item_type: itemType, item_id: itemId, recipient_id: recipientId, permission })
      .select("id, created_at")
      .single();
  const revoke = (client, shareId, revokedAt = new Date().toISOString()) =>
    client.from("shares").update({ revoked_at: revokedAt }).eq("id", shareId).select("revoked_at");

  // ================= C-04: files follow their parent =================
  const j1 = await newJudgment(c1, `${MARK} J1 private reasons`);
  const doc1 = await attach(c1, m1.id, "judgment", j1, `${MARK} provisional reasons`);
  const share13 = must(await share(c1, "judgment", j1, m3.id, "view"), "share J1 with m3");
  check(
    "C-04 control: a view recipient downloads the attachment",
    await readText(c3, doc1.file_path),
    `${MARK} provisional reasons`,
  );

  // The recipient previews it: a derivative in THEIR folder (0083).
  const derivativePath = `${m3.id}/preview-derivatives/${doc1.id}.html`;
  must(
    await c3.storage
      .from("documents")
      .upload(derivativePath, new Blob([`<p>${MARK}</p>`], { type: "text/html" }), {
        contentType: "text/html",
      }),
    "derivative upload",
  );
  created.objects.push(derivativePath);
  check(
    "C-04 control: a viewer still caches a preview derivative in their own folder",
    errorCode(
      await c3.from("documents").insert({
        uploaded_by: m3.id,
        file_name: "preview.html",
        file_path: derivativePath,
        file_size: 10,
        mime_type: "text/html",
        entity_type: "judgment",
        entity_id: j1,
        purpose: "preview_derivative",
        source_document_id: doc1.id,
      }),
    ),
    null,
  );

  const claim = (client, uid, path, extra = {}) =>
    client.from("documents").insert({
      uploaded_by: uid,
      file_name: "claimed.txt",
      file_path: path,
      file_size: 1,
      mime_type: "text/plain",
      ...extra,
    });
  check(
    "C-04 a documents row cannot point into another user's folder",
    errorCode(await claim(c3, m3.id, doc1.file_path)),
    "42501",
  );
  check(
    "C-04 a preview-derivative row cannot point into another user's folder",
    errorCode(
      await claim(c3, m3.id, `${m1.id}/preview-derivatives/${doc1.id}.html`, {
        entity_type: "judgment",
        entity_id: j1,
        purpose: "preview_derivative",
        source_document_id: doc1.id,
      }),
    ),
    "42501",
  );
  {
    const ownPath = `${m3.id}/${MARK}-own.txt`;
    const { error } = await claim(c3, m3.id, ownPath);
    check("C-04 control: a row in the caller's own folder is accepted", error?.code ?? null, null);
    await admin.from("documents").delete().eq("file_path", ownPath);
  }

  must(await revoke(c1, share13.id), "revoke J1 share");
  check(
    "C-04 control: a revoked recipient can no longer download",
    await readText(c3, doc1.file_path),
    null,
  );

  // A delete whose cleanup request never ran (plain delete, no Edge call).
  must(await c1.from("judgments").delete().eq("id", j1), "delete J1 without cleanup");
  const j1Paths = [doc1.file_path, derivativePath].sort();
  check(
    "C-04 a deleted judgment's files are queued, the viewer's derivative too",
    await queued(j1Paths),
    j1Paths,
  );
  check(
    "C-04 a queued file is readable by no one, not even its uploader",
    await readText(c1, doc1.file_path),
    null,
  );
  check(
    "C-04 a revoked recipient cannot claim the deleted file",
    errorCode(await claim(c3, m3.id, doc1.file_path)),
    "42501",
  );
  check("C-04 nor download it", await readText(c3, doc1.file_path), null);

  // The next delete anywhere drains the whole queue, J1's files included.
  const j2 = await newJudgment(c1, `${MARK} J2 draft`);
  const doc2 = await attach(c1, m1.id, "judgment", j2, `${MARK} second draft`);
  await deleteThenCleanStorage(c1, () => c1.from("judgments").delete().eq("id", j2));
  const allJudgmentPaths = [...j1Paths, doc2.file_path];
  check("C-04 the cleanup run drains the queue", await waitUntilDrained(allJudgmentPaths), true);
  check(
    "C-04 the deleted judgments' files are gone from Storage",
    await Promise.all(allJudgmentPaths.map(stored)),
    [false, false, false],
  );

  // Every other parent with attachments.
  {
    const host = await newJudgment(c1, `${MARK} note host`);
    const note = must(
      await c1
        .from("bench_notes")
        .insert({ title: `${MARK} note`, entity_type: "judgment", entity_id: host })
        .select("id")
        .single(),
      "bench note",
    );
    created.benchNotes.push(note.id);
    const qc = must(
      await c1
        .from("quick_codes")
        .insert({ code_word: `${MARK}-qc`.toLowerCase(), content: "text" })
        .select("id")
        .single(),
      "quick code",
    );
    created.quickCodes.push(qc.id);
    const research = must(
      await c1
        .from("case_law")
        .insert({
          owner_id: m1.id,
          case_name: `${MARK} personal research`,
          citation: `${MARK} [2026] P 1`,
          court: "High Court",
          jurisdiction: "Guyana",
        })
        .select("id")
        .single(),
      "personal case law",
    );
    created.caseLaw.push(research.id);
    const matter = must(
      await c1
        .from("docket_matters")
        .insert({
          court_id: courtA,
          district_id: districtD,
          case_number: `${MARK}-PURGE`,
          matter_title: `${MARK} purge`,
        })
        .select("id")
        .single(),
      "docket matter",
    );
    created.matters.push(matter.id);

    const docs = {
      bench_note: await attach(c1, m1.id, "bench_note", note.id, "note file"),
      quick_code: await attach(c1, m1.id, "quick_code", qc.id, "code file"),
      case_law: await attach(c1, m1.id, "case_law", research.id, "research file"),
      docket_matter: await attach(c1, m1.id, "docket_matter", matter.id, "matter file"),
    };
    await deleteThenCleanStorage(c1, () => c1.from("bench_notes").delete().eq("id", note.id));
    await deleteThenCleanStorage(c1, () => c1.from("quick_codes").delete().eq("id", qc.id));
    await deleteThenCleanStorage(c1, () => c1.from("case_law").delete().eq("id", research.id));
    must(await c1.rpc("bin_docket_matter", { p_id: matter.id }), "bin matter");
    await deleteThenCleanStorage(c1, () => c1.rpc("purge_docket_matter", { p_id: matter.id }));
    const paths = Object.values(docs).map((doc) => doc.file_path);
    check(
      "C-04 bench note, quick code, research and matter files drain",
      await waitUntilDrained(paths),
      true,
    );
    for (const [kind, doc] of Object.entries(docs)) {
      check(`C-04 deleting the ${kind} removes its file`, await stored(doc.file_path), false);
    }
  }

  // useDeleteDocument removes the file first; its row delete queues nothing.
  {
    const host = await newJudgment(c1, `${MARK} doc host`);
    const doc = await attach(c1, m1.id, "judgment", host, "single file");
    must(await c1.storage.from("documents").remove([doc.file_path]), "remove file");
    must(await c1.from("documents").delete().eq("id", doc.id), "delete row");
    check(
      "C-04 control: a file removed before its row is not queued",
      await queued([doc.file_path]),
      [],
    );
  }

  // A queued path that a documents row references again is kept.
  {
    const host = await newJudgment(c1, `${MARK} relinked host`);
    const doc = await attach(c1, m1.id, "judgment", host, "still wanted");
    const queuedLive = await admin
      .from("storage_cleanup_queue")
      .insert({ bucket_id: "documents", object_name: doc.file_path });
    check("C-04 the cleanup queue exists", queuedLive.error?.message ?? null, null);
    const { data } = await c1.functions.invoke("storage-cleanup", { method: "POST", body: {} });
    check(
      "C-04 the cleanup run keeps a file a documents row still references",
      data?.kept >= 1,
      true,
    );
    check("C-04 that file is still stored", await stored(doc.file_path), true);
    check("C-04 and its queue entry is dropped", await queued([doc.file_path]), []);
  }

  {
    const res = await fetch(`${URL}/functions/v1/storage-cleanup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ANON}`, apikey: ANON },
    });
    check("C-04 the anon key alone cannot run storage-cleanup", res.status, 401);
    await res.text();
  }
  {
    let threw = false;
    try {
      await requestStorageCleanup(c1);
    } catch {
      threw = true;
    }
    check("C-04 control: a signed-in user's request runs without throwing", threw, false);
  }

  // ================= C-09: research shares reach readers only =================
  const j3 = await newJudgment(c1, `${MARK} R v Secret Accused`);
  const resolve = async (itemType, itemId, who) => {
    const { data, error } = await c1.rpc("resolve_item_share_recipient", {
      p_item_type: itemType,
      p_item_id: itemId,
      p_email: who.email,
    });
    return error ? `error ${error.code}` : (data ?? []).map((row) => row.profile_id);
  };
  check(
    "C-09 a clerk is not offered as a judgment recipient",
    await resolve("judgment", j3, clerk),
    [],
  );
  check("C-09 nor a magistrate with no court", await resolve("judgment", j3, m4), []);
  check("C-09 control: a sitting magistrate is offered", await resolve("judgment", j3, m3), [
    m3.id,
  ]);
  check("C-09 control: an administrator is offered", await resolve("judgment", j3, curator), [
    curator.id,
  ]);
  const research = must(
    await c1
      .from("case_law")
      .insert({
        owner_id: m1.id,
        case_name: `${MARK} shared research`,
        citation: `${MARK} [2026] P 2`,
        court: "High Court",
        jurisdiction: "Guyana",
      })
      .select("id")
      .single(),
    "personal research",
  );
  created.caseLaw.push(research.id);
  check(
    "C-09 a clerk is not offered as a research recipient",
    await resolve("case_law", research.id, clerk),
    [],
  );
  {
    const toClerk = await share(c1, "judgment", j3, clerk.id, "view");
    check(
      "C-09 a direct judgment share to a clerk is refused",
      toClerk.error?.message ?? null,
      RESEARCH_SHARE_REFUSED,
    );
    const researchToClerk = await share(c1, "case_law", research.id, clerk.id, "view");
    check(
      "C-09 a direct research share to a clerk is refused",
      researchToClerk.error?.message ?? null,
      RESEARCH_SHARE_REFUSED,
    );
    const toCourtless = await share(c1, "judgment", j3, m4.id, "view");
    check(
      "C-09 a direct judgment share to a magistrate with no court is refused",
      toCourtless.error?.message ?? null,
      RESEARCH_SHARE_REFUSED,
    );
    const { count } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", clerk.id)
      .eq("link", `/judgments/${j3}`);
    check("C-09 the clerk is never told about a refused share", count, 0);
  }
  must(await share(c1, "judgment", j3, m3.id, "view"), "share J3 with m3");
  must(await share(c1, "judgment", j3, m2.id, "view"), "share J3 with m2");
  must(await share(c1, "case_law", research.id, m3.id, "view"), "research share control");
  // m2 leaves the bench: they keep the share row but can no longer read it.
  await unseat(m2.id);
  must(await c1.from("judgments").update({ status: "final" }).eq("id", j3), "finalise J3");
  check(
    "C-09 a reader is told, in British spelling, with the title they can read",
    (await noticesFor(c3, `/judgments/${j3}`)).filter((n) => n.type === "judgment_final"),
    [
      {
        type: "judgment_final",
        title: "A judgment was finalised",
        body: `${MARK} R v Secret Accused`,
      },
    ],
  );
  check(
    "C-09 a recipient who can no longer read it gets no notice and no title",
    (await noticesFor(c2, `/judgments/${j3}`)).filter((n) => n.type === "judgment_final"),
    [],
  );

  // ================= B-13: a level change is announced =================
  const matter = must(
    await c1
      .from("docket_matters")
      .insert({
        court_id: courtA,
        district_id: districtD,
        case_number: `${MARK}-SHARE`,
        matter_title: `${MARK} shared matter`,
      })
      .select("id")
      .single(),
    "matter to share",
  );
  created.matters.push(matter.id);
  {
    const view = must(await share(c1, "docket_matter", matter.id, m3.id, "view"), "view share");
    must(await revoke(c1, view.id), "revoke view");
    must(await share(c1, "docket_matter", matter.id, m3.id, "edit"), "edit share");
    const feed = await noticesFor(c3, `/docket/${matter.id}`);
    check(
      "B-13 the recipient sees the grant, the revoke and the new level, in order",
      feed.map((n) => `${n.type}: ${n.body}`),
      [
        "share_granted: You were granted view access.",
        "share_revoked: Your access to a docket matter was revoked.",
        "share_granted: You were granted edit access.",
      ],
    );
    const { error } = await c3
      .from("docket_matters")
      .update({ matter_title: `${MARK} edited by recipient` })
      .eq("id", matter.id);
    check("B-13 control: the announced edit access is real", error?.message ?? null, null);
  }
  {
    const j4 = await newJudgment(c1, `${MARK} level change`);
    const view = must(await share(c1, "judgment", j4, m3.id, "view"), "judgment view");
    must(await revoke(c1, view.id), "revoke judgment view");
    must(await share(c1, "judgment", j4, m3.id, "edit"), "judgment edit");
    check(
      "B-13 a judgment re-share is announced too",
      (await noticesFor(c3, `/judgments/${j4}`)).map((n) => n.body),
      [
        "You were granted view access.",
        "Your access to a judgment was revoked.",
        "You were granted edit access.",
      ],
    );
  }
  {
    // Ordinary notices are still collapsed within 20 hours.
    await unseat(m5.id);
    await seat(m5.id, courtC);
    const { data } = await c5.from("notifications").select("type").eq("type", "court_assigned");
    check("B-13 control: a repeated court assignment is still one notice", (data ?? []).length, 1);
  }

  // ================= B-16: the server stamps the revoke =================
  {
    const j5 = await newJudgment(c1, `${MARK} revoke clock`);
    const slow = must(await share(c1, "judgment", j5, m3.id, "view"), "share for slow clock");
    const slowClock = new Date(Date.parse(slow.created_at) - 2 * 60_000).toISOString();
    const before = Date.now();
    const slowRes = await revoke(c1, slow.id, slowClock);
    check("B-16 a device two minutes slow can revoke", slowRes.error?.message ?? null, null);
    const stamped = Date.parse(slowRes.data?.[0]?.revoked_at ?? "");
    check(
      "B-16 the stored revoke time is the server's, not the device's",
      stamped >= Date.parse(slow.created_at) && Math.abs(stamped - before) < 60_000,
      true,
    );
    const j6 = await newJudgment(c1, `${MARK} revoke clock, fast`);
    const fast = must(await share(c1, "judgment", j6, m3.id, "edit"), "share for fast clock");
    const fastRes = await revoke(c1, fast.id, "2099-12-31T00:00:00Z");
    check(
      "B-16 a far-future device time is not stored",
      Math.abs(Date.parse(fastRes.data?.[0]?.revoked_at ?? "") - Date.now()) < 60_000,
      true,
    );
    check(
      "B-16 control: a revoked share still cannot be changed again",
      (await revoke(c1, fast.id)).error?.message ?? null,
      "Cannot modify an already-revoked Share",
    );
    const j7 = await newJudgment(c1, `${MARK} given back`);
    const own = must(await share(c1, "judgment", j7, m3.id, "view"), "share to give back");
    const giveBack = await revoke(c3, own.id);
    check(
      "B-16 control: a recipient can still give access back",
      giveBack.error?.message ?? null,
      null,
    );
  }

  // ================= B-15: district-wide case numbers (ADR 0009) =================
  {
    const number = `${MARK}-0042`;
    must(
      await c1.from("docket_matters").insert({
        court_id: courtA,
        district_id: districtD,
        case_number: number,
        matter_title: `${MARK} Court A secret party`,
      }),
      "court A matter",
    );
    const hidden = await c3.from("docket_matters").select("id").eq("case_number", number);
    check("B-15 another court in the district still cannot see the matter", hidden.data, []);
    const clash = await c3.from("docket_matters").insert({
      court_id: courtB,
      district_id: districtD,
      case_number: number,
      matter_title: `${MARK} Court B`,
    });
    check(
      "B-15 the registry number is unique across the district, by design",
      clash.error?.code ?? null,
      "23505",
    );
    check(
      "B-15 the person sees the plain sentence, not the other matter",
      getErrorMessage(clash.error),
      "That case number already exists in this district.",
    );
    const otherDistrict = await c5.from("docket_matters").insert({
      court_id: courtC,
      district_id: districtE,
      case_number: number,
      matter_title: `${MARK} Court C`,
    });
    check(
      "B-15 control: another district reuses the number",
      otherDistrict.error?.message ?? null,
      null,
    );
  }

  // ================= C-11: bench notes point only at visible parents =================
  {
    const privateJudgment = await newJudgment(c1, `${MARK} private for notes`);
    const note = (client, entityType, entityId) =>
      client
        .from("bench_notes")
        .insert({ title: `${MARK} note`, entity_type: entityType, entity_id: entityId })
        .select("id")
        .single();
    const refused = async (client, entityType, entityId) => {
      const res = await note(client, entityType, entityId);
      if (res.data) created.benchNotes.push(res.data.id);
      return res.error?.message ?? null;
    };
    const accepted = async (client, entityType, entityId) => {
      const res = await note(client, entityType, entityId);
      if (res.data) created.benchNotes.push(res.data.id);
      return res.error?.message ?? null;
    };

    check(
      "C-11 a note on another user's private judgment is refused",
      await refused(c3, "judgment", privateJudgment),
      NOT_FOUND_NOTE("judgment"),
    );
    check(
      "C-11 with the same error as a judgment that does not exist",
      await refused(c3, "judgment", crypto.randomUUID()),
      NOT_FOUND_NOTE("judgment"),
    );
    const personal = must(
      await c1
        .from("case_law")
        .insert({
          owner_id: m1.id,
          case_name: `${MARK} private research`,
          citation: `${MARK} [2026] P 3`,
          court: "High Court",
          jurisdiction: "Guyana",
        })
        .select("id")
        .single(),
      "private research",
    );
    created.caseLaw.push(personal.id);
    check(
      "C-11 a note on another user's private research is refused",
      await refused(c3, "case_law", personal.id),
      NOT_FOUND_NOTE("case_law"),
    );
    const otherCourtMatter = must(
      await c1
        .from("docket_matters")
        .insert({
          court_id: courtA,
          district_id: districtD,
          case_number: `${MARK}-NOTE-A`,
          matter_title: `${MARK} note target`,
        })
        .select("id")
        .single(),
      "court A matter for notes",
    );
    created.matters.push(otherCourtMatter.id);
    check(
      "C-11 a note on another court's matter is refused",
      await refused(c3, "docket_matter", otherCourtMatter.id),
      NOT_FOUND_NOTE("docket_matter"),
    );
    const ownMatter = must(
      await c3
        .from("docket_matters")
        .insert({
          court_id: courtB,
          district_id: districtD,
          case_number: `${MARK}-NOTE-B`,
          matter_title: `${MARK} own matter`,
        })
        .select("id")
        .single(),
      "court B matter",
    );
    created.matters.push(ownMatter.id);
    check(
      "C-11 control: a note on the author's own court matter",
      await accepted(c3, "docket_matter", ownMatter.id),
      null,
    );
    check(
      "C-11 control: the owner notes their own judgment",
      await accepted(c1, "judgment", privateJudgment),
      null,
    );

    const discoverable = await newJudgment(c1, `${MARK} discoverable`);
    must(
      await c1.from("judgments").update({ is_discoverable: true }).eq("id", discoverable),
      "make discoverable",
    );
    check(
      "C-11 control: a note on a discoverable judgment",
      await accepted(c3, "judgment", discoverable),
      null,
    );

    const canonical = must(
      await cCurator
        .from("case_law")
        .insert({
          case_name: `${MARK} v State`,
          citation: `${MARK} [2026] GYHC 9`,
          court: "High Court",
          jurisdiction: "Guyana",
          review_status: "published",
        })
        .select("id")
        .single(),
      "canonical case law",
    );
    created.caseLaw.push(canonical.id);
    check(
      "C-11 control: a note on published canonical Case Law",
      await accepted(c3, "case_law", canonical.id),
      null,
    );

    const published = must(
      await cCurator
        .from("statutes")
        .insert({
          code: `${MARK}-PUB`,
          title: `${MARK} Published Act`,
          jurisdiction: "Guyana",
          review_status: "published",
        })
        .select("id")
        .single(),
      "published statute",
    );
    created.statutes.push(published.id);
    const draft = must(
      await c1
        .from("statutes")
        .insert({
          code: `${MARK}-DRAFT`,
          title: `${MARK} Draft Act`,
          jurisdiction: "Guyana",
          review_status: "draft",
        })
        .select("id")
        .single(),
      "draft statute",
    );
    created.statutes.push(draft.id);
    const provision = async (statuteId) =>
      must(
        await admin
          .from("statute_provisions")
          .insert({ statute_id: statuteId, level: "section", heading: MARK })
          .select("id")
          .single(),
        "provision",
      ).id;
    const publishedSection = await provision(published.id);
    const draftSection = await provision(draft.id);
    check(
      "C-11 control: a note on a published Act",
      await accepted(c3, "statute", published.id),
      null,
    );
    check(
      "C-11 control: a note on a published Act's provision",
      await accepted(c3, "statute_provision", publishedSection),
      null,
    );
    check(
      "C-11 control: the drafter notes their own draft Act",
      await accepted(c1, "statute", draft.id),
      null,
    );
    check(
      "C-11 a note on someone else's draft Act is refused",
      await refused(c3, "statute", draft.id),
      NOT_FOUND_NOTE("statute"),
    );
    check(
      "C-11 a note on someone else's draft provision is refused",
      await refused(c3, "statute_provision", draftSection),
      NOT_FOUND_NOTE("statute_provision"),
    );

    // An existing note survives losing access to, and deletion of, its parent.
    const sharedJudgment = await newJudgment(c1, `${MARK} shared then gone`);
    const grant = must(
      await share(c1, "judgment", sharedJudgment, m3.id, "view"),
      "share for note",
    );
    const kept = must(await note(c3, "judgment", sharedJudgment), "note on shared judgment");
    created.benchNotes.push(kept.id);
    must(await revoke(c1, grant.id), "revoke note parent");
    check(
      "C-11 control: the note is still editable after access is revoked",
      (
        await c3
          .from("bench_notes")
          .update({ title: `${MARK} after revoke` })
          .eq("id", kept.id)
      ).error?.message ?? null,
      null,
    );
    must(await c1.from("judgments").delete().eq("id", sharedJudgment), "delete note parent");
    check(
      "C-11 control: the note is still editable after its parent is deleted",
      (
        await c3
          .from("bench_notes")
          .update({ title: `${MARK} after delete` })
          .eq("id", kept.id)
      ).error?.message ?? null,
      null,
    );
    check(
      "C-11 re-pointing a note at an invisible judgment is refused",
      (await c3.from("bench_notes").update({ entity_id: privateJudgment }).eq("id", kept.id)).error
        ?.message ?? null,
      NOT_FOUND_NOTE("judgment"),
    );
  }
}

async function cleanup() {
  try {
    if (created.benchNotes.length > 0)
      await admin.from("bench_notes").delete().in("id", created.benchNotes);
    await admin.from("bench_notes").delete().like("title", `${MARK}%`);
    const { data: docs } = await admin
      .from("documents")
      .select("id, file_path")
      .like("file_path", `%${MARK}%`);
    if (docs?.length)
      await admin
        .from("documents")
        .delete()
        .in(
          "id",
          docs.map((d) => d.id),
        );
    if (created.objects.length > 0) await admin.storage.from("documents").remove(created.objects);
    await admin.from("storage_cleanup_queue").delete().in("object_name", created.objects);
    if (created.judgments.length > 0) {
      await admin.from("shares").delete().in("item_id", created.judgments);
      await admin.from("judgments").delete().in("id", created.judgments);
    }
    if (created.caseLaw.length > 0) {
      await admin.from("shares").delete().in("item_id", created.caseLaw);
      await admin.from("case_law").delete().in("id", created.caseLaw);
    }
    if (created.quickCodes.length > 0)
      await admin.from("quick_codes").delete().in("id", created.quickCodes);
    if (created.statutes.length > 0) {
      await admin.from("statute_provisions").delete().in("statute_id", created.statutes);
      await admin.from("statutes").delete().in("id", created.statutes);
    }
    const { data: matters } = await admin
      .from("docket_matters")
      .select("id")
      .like("case_number", `${MARK}%`);
    const matterIds = (matters ?? []).map((m) => m.id);
    if (matterIds.length > 0) {
      await admin.from("shares").delete().in("item_id", matterIds);
      await admin.from("docket_matter_assignments").delete().in("docket_matter_id", matterIds);
      await admin.from("docket_matters").delete().in("id", matterIds);
    }
    if (created.courts.length > 0) {
      await admin.from("magistrate_courts").delete().in("court_id", created.courts);
      await admin.from("courts").delete().in("id", created.courts);
    }
    if (created.districts.length > 0)
      await admin.from("magisterial_districts").delete().in("id", created.districts);
    let kept = 0;
    for (const userId of created.users) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) {
        kept += 1;
        await admin.from("profiles").update({ is_active: false }).eq("id", userId);
      }
    }
    console.log(
      kept === 0
        ? "Cleanup complete."
        : `Cleanup complete; ${kept} fixture user(s) referenced by audit_log were deactivated.`,
    );
  } catch (err) {
    console.error("Cleanup error (some fixtures may need manual removal):", err);
  }
}

try {
  await main();
} catch (err) {
  console.error("Test run threw:", err);
  failures += 1;
} finally {
  await cleanup();
}

process.exit(failures > 0 ? 1 : 0);
