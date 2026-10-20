// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * Case Law and the curated legal library keep their integrity and privacy
 * (0162), on a real database.
 *
 * Replays the 2026-10-15 audit's theme T5 repros through the same clients
 * the app uses, each with a control proving the legitimate path still works:
 *
 *   C-01  an EDIT-share recipient of personal Case Law edits its content but
 *         cannot make it discoverable, change its review status or delete
 *         it; the owner still can;
 *   C-02  the curator RPCs (and direct case_law_tags writes) refuse a
 *         personal row exactly like a missing one, and case_law_tags rows
 *         are only visible with their Case Law; curation of canonical rows
 *         still works;
 *   C-03  a magistrate cannot supersede a published canonical Act, at
 *         INSERT or at finalize; finalize needs a document attached to that
 *         statute; a magistrate still publishes a new Act and the admin
 *         still replaces one;
 *   C-05  audit_log rows for personal Case Law, Judgments, Bench Notes,
 *         Quick Codes and their files carry no content, only metadata;
 *         canonical library rows keep their names;
 *   C-06  clerks and magistrates cannot create, rename or delete the global
 *         tags; the admin still curates them;
 *   C-07  a stale reject refuses a published import (Case Law and
 *         Legislation), and a concurrent publish || reject serialises with
 *         no deadlock; rejecting a draft still works;
 *   C-08  unpublished canonical Case Law is invisible to magistrates through
 *         RLS, can_view_case_law, global_search and search_case_law_scoped;
 *         the admin still sees it, and published canonical Case Law stays
 *         readable to signed-in users (and not to anon, per 0160).
 *
 * Creates its own district, court, users and rows (all carrying the fixture
 * mark) and removes every one of them afterwards, pass or fail. audit_log
 * rows stay: the table is append-only and hash-chained.
 *
 *   npm run db:start && npm run test:case-law-library-integrity
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-case-law-library-integrity");
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

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
/** Runs one finding's block; a throw fails that block and the next one still runs. */
async function section(name, body) {
  try {
    await body();
  } catch (err) {
    console.log(`FAIL — ${name} threw: ${err.message}`);
    failures += 1;
  }
}
const must = ({ data, error }, label) => {
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
};
/** The error message of a refused call, or "accepted". */
const outcome = ({ error }) => error?.message ?? "accepted";

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(URL, SERVICE, noSession);
const MARK = `T5-FIX-${Date.now() % 1_000_000}`;
const SECRET = `${MARK}-PRIVATE`;
const PASSWORD = "T5-fixture-pass-123!";
const email = (name) => `${MARK.toLowerCase()}-${name}@example.test`;

const created = {
  users: [],
  courts: [],
  districtId: null,
  caseLaw: [],
  statutes: [],
  judgments: [],
  benchNotes: [],
  quickCodes: [],
  documents: [],
  importJobs: [],
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

async function signIn(emailAddr) {
  const client = createClient(URL, ANON, noSession);
  must(await client.auth.signInWithPassword({ email: emailAddr, password: PASSWORD }), "sign in");
  return client;
}

const rowCount = async (table, id) =>
  must(await admin.from(table).select("id").eq("id", id), `count ${table}`).length;

async function main() {
  // ---------- fixtures ----------
  const district = must(
    await admin
      .from("magisterial_districts")
      .insert({ name: `${MARK} District` })
      .select()
      .single(),
    "district",
  );
  created.districtId = district.id;
  const court = must(
    await admin
      .from("courts")
      .insert({ name: `${MARK} Court`, jurisdiction: "Test", district_id: district.id })
      .select()
      .single(),
    "court",
  );
  created.courts.push(court.id);
  const jurisdiction = must(
    await admin.from("legal_jurisdictions").select("id, name").limit(1).single(),
    "jurisdiction",
  );
  const authorityCourt = must(
    await admin.from("legal_authority_courts").select("id, name:canonical_name").limit(1).single(),
    "authority court",
  );

  const owner = await createUser("owner");
  const recipient = await createUser("recipient");
  const bystander = await createUser("bystander");
  const curator = await createUser("curator");
  const clerk = await createUser("clerk", { requested_role: "clerk" });
  must(await admin.from("profiles").update({ role: "admin" }).eq("id", curator.id), "make admin");
  for (const profileId of [owner.id, recipient.id, bystander.id]) {
    must(
      await admin.from("magistrate_courts").insert({ profile_id: profileId, court_id: court.id }),
      "seat magistrate",
    );
  }

  const ownerClient = await signIn(owner.email);
  const recipientClient = await signIn(recipient.email);
  const bystanderClient = await signIn(bystander.email);
  const curatorA = await signIn(curator.email);
  const curatorB = await signIn(curator.email); // a second curator session on a stale queue
  const clerkClient = await signIn(clerk.email);
  const anonClient = createClient(URL, ANON, noSession);

  let citation = 0;
  const personal = async (client, label, extra = {}) => {
    citation += 1;
    const row = must(
      await client
        .from("case_law")
        .insert({
          case_name: `${MARK} ${label}`,
          citation: `${MARK} [2026] PR ${citation}`,
          court: "High Court",
          jurisdiction: "Guyana",
          owner_id: owner.id,
          ...extra,
        })
        .select()
        .single(),
      `personal case law ${label}`,
    );
    created.caseLaw.push(row.id);
    return row;
  };
  const importCaseLaw = async (label, extra = {}) => {
    citation += 1;
    const [row] = must(
      await curatorA.rpc("create_case_law_import", {
        p_case_name: `${MARK} ${label} v State`,
        p_citation: `${MARK} [2026] CCJ ${citation}`,
        p_court: authorityCourt.name,
        p_jurisdiction: jurisdiction.name,
        p_court_id: authorityCourt.id,
        p_jurisdiction_id: jurisdiction.id,
        ...extra,
      }),
      `case law import ${label}`,
    );
    created.caseLaw.push(row.case_law_id);
    created.importJobs.push(row.import_job_id);
    return row;
  };
  const share = async (itemId, recipientId, permission) =>
    must(
      await ownerClient.from("shares").insert({
        item_type: "case_law",
        item_id: itemId,
        recipient_id: recipientId,
        permission,
        granted_by: owner.id,
      }),
      `share ${permission}`,
    );

  const tagName = `${MARK} Bail Pending Appeal`;
  const canonical = await importCaseLaw("Canonical", { p_full_text: `${MARK} canonical text` });
  // Idempotent: replaces the canonical row's tag set with the curated topic.
  const tagCanonical = async () =>
    must(
      await curatorA.rpc("apply_case_law_tags", {
        p_case_law_id: canonical.case_law_id,
        p_tag_names: [tagName],
      }),
      "tag canonical",
    );

  // ---------- C-01: an edit share edits content, never visibility or existence ----------
  await section("C-01", async () => {
    const a = await personal(ownerClient, "shared research A");
    const b = await personal(ownerClient, "shared research B");
    await share(a.id, recipient.id, "edit");
    await share(b.id, recipient.id, "edit");

    const edit = await recipientClient
      .from("case_law")
      .update({ principles: `${MARK} edited by the recipient` })
      .eq("id", a.id)
      .select("principles");
    check(
      "C-01 control: the edit-share recipient still edits the content",
      edit.data?.map((r) => r.principles),
      [`${MARK} edited by the recipient`],
    );
    check(
      "C-01 the edit-share recipient cannot make the research discoverable",
      outcome(
        await recipientClient.from("case_law").update({ is_discoverable: true }).eq("id", a.id),
      ),
      "Only the owner of this Case Law research may change its discoverability or review status.",
    );
    check(
      "C-01 the edit-share recipient cannot change its review status",
      outcome(
        await recipientClient.from("case_law").update({ review_status: "draft" }).eq("id", a.id),
      ),
      "Only the owner of this Case Law research may change its discoverability or review status.",
    );
    check(
      "C-01 an unrelated magistrate still cannot read it",
      must(await bystanderClient.from("case_law").select("id").eq("id", a.id), "bystander read")
        .length,
      0,
    );
    const del = await recipientClient.from("case_law").delete().eq("id", b.id).select("id");
    check(
      "C-01 the edit-share recipient's delete removes nothing",
      del.data ?? del.error?.code,
      [],
    );
    check("C-01 the owner's record survives", await rowCount("case_law", b.id), 1);

    check(
      "C-01 control: the owner still makes it discoverable",
      outcome(await ownerClient.from("case_law").update({ is_discoverable: true }).eq("id", a.id)),
      "accepted",
    );
    check(
      "C-01 control: an unrelated magistrate then reads it",
      must(await bystanderClient.from("case_law").select("id").eq("id", a.id), "bystander read")
        .length,
      1,
    );
    const ownDelete = await ownerClient.from("case_law").delete().eq("id", b.id).select("id");
    check("C-01 control: the owner still deletes their research", ownDelete.data?.length, 1);
  });

  // ---------- C-02: curator RPCs reach canonical rows only ----------
  await section("C-02", async () => {
    const p = await personal(ownerClient, "private research", { summary: "my private notes" });
    const notFound = `Case Law record ${p.id} not found.`;
    check(
      "C-02 the admin cannot see the personal row through RLS",
      must(await curatorA.from("case_law").select("id").eq("id", p.id), "admin read").length,
      0,
    );
    check(
      "C-02 set_case_law_review_status refuses a personal row as not found",
      outcome(
        await curatorA.rpc("set_case_law_review_status", {
          p_case_law_id: p.id,
          p_status: "draft",
        }),
      ),
      notFound,
    );
    check(
      "C-02 apply_case_law_tags refuses a personal row as not found",
      outcome(
        await curatorA.rpc("apply_case_law_tags", { p_case_law_id: p.id, p_tag_names: [tagName] }),
      ),
      notFound,
    );
    check(
      "C-02 publish_case_law_import refuses a personal row as not found",
      outcome(await curatorA.rpc("publish_case_law_import", { p_case_law_id: p.id })),
      notFound,
    );
    check(
      "C-02 reject_case_law_import refuses a personal row as not found",
      outcome(await curatorA.rpc("reject_case_law_import", { p_case_law_id: p.id, p_reason: "x" })),
      notFound,
    );
    const after = must(
      await admin.from("case_law").select("review_status").eq("id", p.id),
      "personal row after RPCs",
    );
    check("C-02 the personal row is still there and still published", after, [
      { review_status: "published" },
    ]);

    check(
      "C-02 control: the admin still curates canonical Case Law (status)",
      outcome(
        await curatorA.rpc("set_case_law_review_status", {
          p_case_law_id: canonical.case_law_id,
          p_status: "ready",
        }),
      ),
      "accepted",
    );
    check(
      "C-02 control: the admin still tags canonical Case Law",
      outcome(
        await curatorA.rpc("apply_case_law_tags", {
          p_case_law_id: canonical.case_law_id,
          p_tag_names: [tagName],
        }),
      ),
      "accepted",
    );
    const tag = must(
      await admin.from("tags").select("id").eq("name", tagName).single(),
      "curated tag",
    );
    const directTag = await curatorA
      .from("case_law_tags")
      .insert({ case_law_id: p.id, tag_id: tag.id });
    check("C-02 the admin cannot tag a personal row directly", directTag.error?.code, "42501");

    // A personal row tagged by the service role: its tag rows follow its visibility.
    must(await admin.from("case_law_tags").insert({ case_law_id: p.id, tag_id: tag.id }), "tag");
    const tagRows = async (client, id) =>
      must(await client.from("case_law_tags").select("tag_id").eq("case_law_id", id), "tags")
        .length;
    check(
      "C-02 an unrelated magistrate cannot see a personal row's tags",
      await tagRows(bystanderClient, p.id),
      0,
    );
    check("C-02 the admin cannot see a personal row's tags", await tagRows(curatorA, p.id), 0);
    check("C-02 control: the owner sees their row's tags", await tagRows(ownerClient, p.id), 1);
    check(
      "C-02 the admin cannot untag a personal row directly",
      (await curatorA.from("case_law_tags").delete().eq("case_law_id", p.id).select("tag_id")).data,
      [],
    );
  });

  // ---------- C-06: the global tag taxonomy is admin-curated ----------
  await section("C-06", async () => {
    for (const [who, client, profileId] of [
      ["a clerk", clerkClient, clerk.id],
      ["a magistrate", bystanderClient, bystander.id],
    ]) {
      const insert = await client
        .from("tags")
        .insert({ name: `${MARK} squat by ${who}`, created_by: profileId });
      check(`C-06 ${who} cannot create a tag`, insert.error?.code, "42501");
    }

    // A tag a clerk squatted before 0162, which the curator then reused by
    // lower(name) on canonical Case Law (the audit repro).
    const squatName = `${MARK} Squatted Topic`;
    const squatted = must(
      await admin.from("tags").insert({ name: squatName, created_by: clerk.id }).select().single(),
      "legacy squatted tag",
    );
    must(
      await curatorA.rpc("apply_case_law_tags", {
        p_case_law_id: canonical.case_law_id,
        p_tag_names: [squatName.toLowerCase()],
      }),
      "curator reuses the squatted tag",
    );
    for (const [who, client] of [
      ["the clerk who created it", clerkClient],
      ["a magistrate", bystanderClient],
    ]) {
      const rename = await client
        .from("tags")
        .update({ name: `${MARK} IGNORE - overruled` })
        .eq("id", squatted.id)
        .select("id");
      check(`C-06 ${who} cannot rename a tag on canonical Case Law`, rename.data, []);
      const del = await client.from("tags").delete().eq("id", squatted.id).select("id");
      check(`C-06 ${who} cannot delete a tag on canonical Case Law`, del.data, []);
    }
    check(
      "C-06 the tag keeps its name and stays on the canonical record",
      must(
        await admin
          .from("case_law_tags")
          .select("tags(name)")
          .eq("case_law_id", canonical.case_law_id)
          .eq("tag_id", squatted.id),
        "canonical tag",
      ),
      [{ tags: { name: squatName } }],
    );
    check(
      "C-06 control: a magistrate still reads the tags",
      must(await bystanderClient.from("tags").select("id").eq("id", squatted.id), "tag read")
        .length,
      1,
    );
    const renamed = await curatorA
      .from("tags")
      .update({ name: `${squatName} (curated)` })
      .eq("id", squatted.id)
      .select("name");
    check("C-06 control: the admin still renames a tag", renamed.data, [
      { name: `${squatName} (curated)` },
    ]);
    const removed = await curatorA.from("tags").delete().eq("id", squatted.id).select("id");
    check("C-06 control: the admin still deletes a tag", removed.data?.length, 1);
  });

  // ---------- C-08: unpublished canonical Case Law is the admin's ----------
  await section("C-08", async () => {
    const word = `${MARK.replace(/-/g, "")}unreviewed`;
    const draft = await importCaseLaw(`Imported ${word}`, {
      p_full_text: `garbled OCR ${word} text not yet reviewed`,
      p_content_quality_status: "failed",
    });
    // is_discoverable is inert on canonical rows; it must not open a draft either.
    must(
      await admin.from("case_law").update({ is_discoverable: true }).eq("id", draft.case_law_id),
      "flag canonical draft discoverable",
    );
    check(
      "C-08 a magistrate cannot read an unpublished canonical row",
      must(
        await bystanderClient.from("case_law").select("id").eq("id", draft.case_law_id),
        "magistrate read",
      ).length,
      0,
    );
    check(
      "C-08 can_view_case_law is false for a magistrate",
      must(
        await bystanderClient.rpc("can_view_case_law", { p_case_law_id: draft.case_law_id }),
        "can_view",
      ),
      false,
    );
    const global = must(
      await bystanderClient.rpc("global_search", { p_query: word, p_limit: 20 }),
      "global_search",
    );
    check(
      "C-08 global_search does not return it",
      global.some((r) => r.id === draft.case_law_id),
      false,
    );
    const scoped = must(
      await bystanderClient.rpc("search_case_law_scoped", { p_query: word, p_limit: 20 }),
      "search_case_law_scoped",
    );
    check(
      "C-08 search_case_law_scoped does not return it",
      scoped.some((r) => r.id === draft.case_law_id),
      false,
    );
    check(
      "C-08 control: the admin still reads the review queue row",
      must(await curatorA.from("case_law").select("id").eq("id", draft.case_law_id), "admin read")
        .length,
      1,
    );

    must(
      await curatorA.rpc("publish_case_law_import", { p_case_law_id: canonical.case_law_id }),
      "publish canonical",
    );
    check(
      "C-08 control: a signed-in magistrate reads published canonical Case Law",
      must(
        await bystanderClient.from("case_law").select("id").eq("id", canonical.case_law_id),
        "magistrate read",
      ).length,
      1,
    );
    await tagCanonical();
    check(
      "C-08 control: and its tags",
      must(
        await bystanderClient
          .from("case_law_tags")
          .select("tag_id")
          .eq("case_law_id", canonical.case_law_id),
        "magistrate tag read",
      ).length,
      1,
    );
    check(
      "C-08 (0160 kept) anon reads no published canonical Case Law",
      must(await anonClient.from("case_law").select("id").eq("id", canonical.case_law_id), "anon")
        .length,
      0,
    );
    check(
      "C-08 (0160 kept) can_view_case_law is false for anon",
      must(
        await anonClient.rpc("can_view_case_law", { p_case_law_id: canonical.case_law_id }),
        "anon can_view",
      ),
      false,
    );
  });

  // ---------- C-07: a stale reject refuses a published import; publish || reject serialise ----------
  await section("C-07", async () => {
    const imp = await importCaseLaw("Stale reject");
    must(
      await curatorA.rpc("publish_case_law_import", { p_case_law_id: imp.case_law_id }),
      "publish",
    );
    check(
      "C-07 a stale reject refuses an already-published Case Law record",
      outcome(
        await curatorB.rpc("reject_case_law_import", {
          p_case_law_id: imp.case_law_id,
          p_reason: "stale reject",
        }),
      ),
      "This Case Law record has already been published, so it can no longer be rejected. Refresh the review queue.",
    );
    check(
      "C-07 the published Case Law record survives",
      await rowCount("case_law", imp.case_law_id),
      1,
    );
    check(
      "C-07 its import job stays published",
      must(await admin.from("import_jobs").select("status").eq("id", imp.import_job_id), "job"),
      [{ status: "published" }],
    );

    const [li] = must(
      await curatorA.rpc("create_legislation_import", {
        p_code: `${MARK}-CAP`,
        p_title: `${MARK} Stale Reject Act`,
        p_jurisdiction: jurisdiction.name,
        p_jurisdiction_id: jurisdiction.id,
      }),
      "legislation import",
    );
    created.statutes.push(li.statute_id);
    created.importJobs.push(li.import_job_id);
    must(
      await curatorA.rpc("publish_legislation_import", { p_statute_id: li.statute_id }),
      "publish",
    );
    check(
      "C-07 a stale reject refuses an already-published Legislation record",
      outcome(
        await curatorB.rpc("reject_legislation_import", {
          p_statute_id: li.statute_id,
          p_reason: "stale reject",
        }),
      ),
      "This Legislation record has already been published, so it can no longer be rejected. Refresh the review queue.",
    );
    check(
      "C-07 the published Legislation record survives",
      await rowCount("statutes", li.statute_id),
      1,
    );

    const outcomes = [];
    for (let i = 0; i < 6; i += 1) {
      const race = await importCaseLaw(`Race ${i}`);
      const [pub, rej] = await Promise.all([
        curatorA.rpc("publish_case_law_import", { p_case_law_id: race.case_law_id }),
        curatorB.rpc("reject_case_law_import", {
          p_case_law_id: race.case_law_id,
          p_reason: "race",
        }),
      ]);
      const left = must(
        await admin.from("case_law").select("review_status").eq("id", race.case_law_id),
        "race row",
      );
      const published = !pub.error && !!rej.error?.message.includes("already been published");
      const rejected =
        !rej.error && pub.error?.message === `Case Law record ${race.case_law_id} not found.`;
      outcomes.push(
        published && left[0]?.review_status === "published"
          ? "published"
          : rejected && left.length === 0
            ? "rejected"
            : `inconsistent: publish=${pub.error?.message ?? "ok"} reject=${rej.error?.message ?? "ok"} rows=${JSON.stringify(left)}`,
      );
    }
    check(
      "C-07 concurrent publish || reject always ends cleanly one way or the other, never deadlocked",
      outcomes.filter((o) => o !== "published" && o !== "rejected"),
      [],
    );

    const draft = await importCaseLaw("Rejectable draft");
    check(
      "C-07 control: rejecting a draft import still works",
      outcome(
        await curatorB.rpc("reject_case_law_import", {
          p_case_law_id: draft.case_law_id,
          p_reason: "not needed",
        }),
      ),
      "accepted",
    );
    check(
      "C-07 control: the rejected draft is gone",
      await rowCount("case_law", draft.case_law_id),
      0,
    );
    check(
      "C-07 control: its job is marked failed with the reason",
      must(
        await admin
          .from("import_jobs")
          .select("status, error_summary")
          .eq("id", draft.import_job_id),
        "job",
      ),
      [{ status: "failed", error_summary: "not needed" }],
    );
  });

  // ---------- C-03: replacing a published Act stays admin-only ----------
  await section("C-03", async () => {
    const act = must(
      await curatorA
        .from("statutes")
        .insert({
          code: `${MARK}-ACT`,
          title: `${MARK} Summary Jurisdiction Act`,
          jurisdiction: jurisdiction.name,
          jurisdiction_id: jurisdiction.id,
          review_status: "published",
          is_current_version: true,
        })
        .select()
        .single(),
      "canonical act",
    );
    created.statutes.push(act.id);
    const attach = async (client, uploader, statuteId) => {
      const doc = must(
        await client
          .from("documents")
          .insert({
            uploaded_by: uploader,
            file_name: `${MARK}.pdf`,
            file_path: `${uploader}/statute/${statuteId}/${MARK}.pdf`,
            file_size: 40,
            mime_type: "application/pdf",
            entity_type: "statute",
            entity_id: statuteId,
          })
          .select("id")
          .single(),
        "attach statute document",
      );
      created.documents.push(doc.id);
      return doc.id;
    };
    const draftValues = (suffix, extra = {}) => ({
      code: `${MARK}-ACT`,
      title: `${MARK} Summary Jurisdiction Act (${suffix})`,
      jurisdiction: jurisdiction.name,
      jurisdiction_id: jurisdiction.id,
      review_status: "draft",
      is_current_version: false,
      ...extra,
    });

    const squat = await ownerClient
      .from("statutes")
      .insert({
        ...draftValues("magistrate copy"),
        supersedes_statute_id: act.id,
        created_by: owner.id,
      })
      .select("id");
    check(
      "C-03 a magistrate cannot insert a draft that supersedes an Act",
      squat.error?.code,
      "42501",
    );

    // A superseding magistrate draft that got in anyway (service role) is still refused at finalize.
    const smuggled = must(
      await admin
        .from("statutes")
        .insert({ ...draftValues("smuggled"), supersedes_statute_id: act.id, created_by: owner.id })
        .select()
        .single(),
      "smuggled draft",
    );
    created.statutes.push(smuggled.id);
    const smuggledDoc = await attach(ownerClient, owner.id, smuggled.id);
    check(
      "C-03 finalize refuses a magistrate's superseding draft",
      outcome(
        await ownerClient.rpc("finalize_legislation_document", {
          p_statute_id: smuggled.id,
          p_document_id: smuggledDoc,
        }),
      ),
      "Only administrators may replace existing Legislation; magistrates may only publish a new Act they just created.",
    );
    check(
      "C-03 the canonical Act stays current and published",
      must(
        await admin.from("statutes").select("review_status, is_current_version").eq("id", act.id),
        "act",
      ),
      [{ review_status: "published", is_current_version: true }],
    );

    const fresh = must(
      await ownerClient
        .from("statutes")
        .insert({
          ...draftValues("new Act"),
          code: `${MARK}-NEW`,
          created_by: owner.id,
          is_current_version: true,
        })
        .select()
        .single(),
      "magistrate new act",
    );
    created.statutes.push(fresh.id);
    const freshDoc = await attach(ownerClient, owner.id, fresh.id);
    check(
      "C-03 finalize refuses a document attached to a different statute",
      outcome(
        await ownerClient.rpc("finalize_legislation_document", {
          p_statute_id: fresh.id,
          p_document_id: smuggledDoc,
        }),
      ),
      "The Legislation file must be attached to this record before it can be published.",
    );
    check(
      "C-03 control: a magistrate still publishes a new Act they created",
      outcome(
        await ownerClient.rpc("finalize_legislation_document", {
          p_statute_id: fresh.id,
          p_document_id: freshDoc,
        }),
      ),
      "accepted",
    );

    const replacement = must(
      await curatorA
        .from("statutes")
        .insert({ ...draftValues("2026 revision"), supersedes_statute_id: act.id })
        .select()
        .single(),
      "admin replacement",
    );
    created.statutes.push(replacement.id);
    const replacementDoc = await attach(curatorA, curator.id, replacement.id);
    check(
      "C-03 control: the admin still replaces an Act",
      outcome(
        await curatorA.rpc("finalize_legislation_document", {
          p_statute_id: replacement.id,
          p_document_id: replacementDoc,
        }),
      ),
      "accepted",
    );
    check(
      "C-03 control: the replaced Act is no longer current",
      must(await admin.from("statutes").select("is_current_version").eq("id", act.id), "act"),
      [{ is_current_version: false }],
    );
  });

  // ---------- C-05: audit_log carries metadata, not private content ----------
  await section("C-05", async () => {
    const research = await personal(ownerClient, `${SECRET} research`, {
      principles: `${SECRET} principle`,
      key_passages: `${SECRET} passage`,
      issues: `${SECRET} issue`,
      parties: `${SECRET} parties`,
    });
    must(
      await ownerClient
        .from("case_law")
        .update({ disposition: `${SECRET} disposition` })
        .eq("id", research.id),
      "update research",
    );
    const judgment = must(
      await ownerClient
        .from("judgments")
        .insert({ title: `${SECRET} R v Accused`, case_number: `${SECRET}-CN`, status: "draft" })
        .select("id")
        .single(),
      "private judgment",
    );
    created.judgments.push(judgment.id);
    const note = must(
      await ownerClient
        .from("bench_notes")
        .insert({
          title: `${SECRET} witness X lied`,
          entity_type: "case_law",
          entity_id: research.id,
        })
        .select("id")
        .single(),
      "bench note",
    );
    created.benchNotes.push(note.id);
    const code = must(
      await ownerClient
        .from("quick_codes")
        .insert({
          code_word: `${MARK.toLowerCase()}-code`,
          title: `${SECRET} code title`,
          content: "x",
        })
        .select("id")
        .single(),
      "quick code",
    );
    created.quickCodes.push(code.id);
    const file = must(
      await ownerClient
        .from("documents")
        .insert({
          uploaded_by: owner.id,
          file_name: `${SECRET} statement.pdf`,
          file_path: `${owner.id}/${MARK}-statement.pdf`,
          file_size: 10,
          mime_type: "application/pdf",
          entity_type: "judgment",
          entity_id: judgment.id,
        })
        .select("id")
        .single(),
      "private attachment",
    );
    created.documents.push(file.id);
    must(await ownerClient.from("case_law").delete().eq("id", research.id), "delete research");

    const ids = [research.id, judgment.id, note.id, code.id, file.id];
    const rows = must(
      await curatorA
        .from("audit_log")
        .select("table_name, action, record_id, old_data, new_data")
        .in("record_id", ids),
      "admin audit read",
    );
    const leaks = rows
      .filter((r) =>
        JSON.stringify([r.old_data, r.new_data]).toLowerCase().includes(MARK.toLowerCase()),
      )
      .map((r) => `${r.table_name}/${r.action}`);
    check("C-05 the admin reads audit rows for every private write", rows.length >= 7, true);
    check("C-05 no audit row carries private titles, names, research or file names", leaks, []);
    const researchInsert = rows.find((r) => r.record_id === research.id && r.action === "insert");
    check(
      "C-05 control: the personal Case Law audit row keeps its metadata",
      [researchInsert?.new_data?.owner_id, researchInsert?.new_data?.review_status],
      [owner.id, "published"],
    );

    const canonicalInsert = must(
      await curatorA
        .from("audit_log")
        .select("new_data")
        .eq("record_id", canonical.case_law_id)
        .eq("action", "insert"),
      "canonical audit",
    );
    check(
      "C-05 control: canonical Case Law audit rows keep the case name",
      canonicalInsert[0]?.new_data?.case_name?.toLowerCase(),
      `${MARK} canonical v state`.toLowerCase(),
    );
  });
}

async function cleanup() {
  try {
    if (created.documents.length > 0)
      await admin.from("documents").delete().in("id", created.documents);
    if (created.benchNotes.length > 0)
      await admin.from("bench_notes").delete().in("id", created.benchNotes);
    if (created.quickCodes.length > 0)
      await admin.from("quick_codes").delete().in("id", created.quickCodes);
    if (created.judgments.length > 0)
      await admin.from("judgments").delete().in("id", created.judgments);
    if (created.caseLaw.length > 0) {
      await admin.from("shares").delete().in("item_id", created.caseLaw);
      await admin.from("case_law").delete().in("id", created.caseLaw);
    }
    if (created.statutes.length > 0) {
      await admin
        .from("statutes")
        .update({ supersedes_statute_id: null })
        .in("id", created.statutes);
      await admin.from("statutes").delete().in("id", created.statutes);
    }
    if (created.importJobs.length > 0)
      await admin.from("import_jobs").delete().in("id", created.importJobs);
    await admin.from("tags").delete().like("name", `${MARK}%`);
    if (created.courts.length > 0) {
      await admin.from("magistrate_courts").delete().in("court_id", created.courts);
      await admin.from("courts").delete().in("id", created.courts);
    }
    if (created.districtId)
      await admin.from("magisterial_districts").delete().eq("id", created.districtId);
    for (const userId of created.users) await admin.auth.admin.deleteUser(userId);
    console.log("Cleanup complete.");
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
