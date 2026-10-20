// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * The anonymous and sign-up surface stays closed (0160), on a real database.
 *
 * Replays the 2026-10-15 audit's theme T4 repros through the same clients
 * the app and an attacker would use:
 *
 *   A-04  the public anon key, with no session, reads no Judgments, Case Law,
 *         Statutes, provisions, reference tables, attached documents or
 *         their files, while a signed-in magistrate still reads all of them;
 *   A-01  a real sign-up carrying `court_id` metadata gets no court, and a
 *         profiles.court_id with no approved assignment grants nothing on
 *         the legacy `cases` table until the request is approved;
 *   A-03  a clerk cannot request access to an inactive court;
 *   A-02  a double submit (sequential and concurrent) gets a plain sentence,
 *         never a raw 23505;
 *   C-12  anon cannot execute search_quick_codes or search_cases.
 *
 * Creates its own district, courts, users and rows (all carrying the fixture
 * mark) and removes every one of them afterwards, pass or fail.
 *
 *   npm run db:start && npm run test:anon-auth-surface
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-anon-auth-surface");
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
const must = ({ data, error }, label) => {
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
};

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(URL, SERVICE, noSession);
const anon = () => createClient(URL, ANON, noSession);
const MARK = `T4-FIX-${Date.now() % 1_000_000}`;
const PASSWORD = "T4-fixture-pass-123!";
const email = (name) => `${MARK.toLowerCase()}-${name}@example.test`;

const created = {
  users: [],
  courts: [],
  districtId: null,
  judgments: [],
  caseLaw: [],
  statutes: [],
  cases: [],
  documents: [],
  objects: [],
};

async function createUser(name, meta) {
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

async function seat(profileId, courtId) {
  must(
    await admin.from("magistrate_courts").insert({ profile_id: profileId, court_id: courtId }),
    "seat magistrate",
  );
}

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
  const court = async (suffix, isActive) => {
    const row = must(
      await admin
        .from("courts")
        .insert({
          name: `${MARK} ${suffix}`,
          jurisdiction: "Test",
          district_id: district.id,
          is_active: isActive,
        })
        .select()
        .single(),
      `court ${suffix}`,
    );
    created.courts.push(row.id);
    return row.id;
  };
  const courtA = await court("Court A", true);
  const courtB = await court("Court B", true);
  const courtInactive = await court("Closed Court", false);

  const author = await createUser("author", {});
  const reader = await createUser("reader", {});
  const reviewer = await createUser("reviewer", {});
  must(await admin.from("profiles").update({ role: "admin" }).eq("id", reviewer.id), "make admin");
  await seat(author.id, courtA);
  await seat(reader.id, courtA);

  const authorClient = await signIn(author.email);
  const readerClient = await signIn(reader.email);
  const reviewerClient = await signIn(reviewer.email);

  // ---------- A-04: anon reads none of the library ----------
  const SECRET = `${MARK}-RULING-BODY`;
  const discoverable = must(
    await authorClient
      .from("judgments")
      .insert({ title: `${MARK} discoverable`, content: { body: SECRET }, status: "draft" })
      .select("id")
      .single(),
    "discoverable judgment",
  );
  created.judgments.push(discoverable.id);
  must(
    await authorClient
      .from("judgments")
      .update({ is_discoverable: true })
      .eq("id", discoverable.id),
    "make discoverable",
  );
  const canonical = must(
    await reviewerClient
      .from("case_law")
      .insert({
        case_name: `${MARK} v State`,
        citation: `${MARK} [2026] GYHC 1`,
        court: "High Court",
        jurisdiction: "Guyana",
        full_text: SECRET,
        review_status: "published",
      })
      .select("id")
      .single(),
    "canonical case law",
  );
  created.caseLaw.push(canonical.id);
  const statute = must(
    await reviewerClient
      .from("statutes")
      .insert({
        code: `${MARK}-ACT`,
        title: `${MARK} Act`,
        jurisdiction: "Guyana",
        full_text: SECRET,
        review_status: "published",
      })
      .select("id")
      .single(),
    "published statute",
  );
  created.statutes.push(statute.id);
  must(
    await admin
      .from("statute_provisions")
      .insert({ statute_id: statute.id, level: "section", heading: MARK, body_text: SECRET }),
    "provision",
  );

  const filePath = `${author.id}/${MARK}-ruling.txt`;
  must(
    await admin.storage
      .from("documents")
      .upload(filePath, new Blob([SECRET], { type: "text/plain" }), { contentType: "text/plain" }),
    "upload ruling file",
  );
  created.objects.push(filePath);
  for (const [entityType, entityId, path] of [
    ["judgment", discoverable.id, filePath],
    ["case_law", canonical.id, `${author.id}/${MARK}-case.txt`],
    ["statute", statute.id, `${author.id}/${MARK}-act.txt`],
  ]) {
    const doc = must(
      await admin
        .from("documents")
        .insert({
          uploaded_by: author.id,
          file_name: `${MARK}.txt`,
          file_path: path,
          file_size: SECRET.length,
          mime_type: "text/plain",
          entity_type: entityType,
          entity_id: entityId,
        })
        .select("id")
        .single(),
      `document on ${entityType}`,
    );
    created.documents.push(doc.id);
  }

  const a = anon();
  const anonRows = async (table, column, value) => {
    const { data, error } = await a.from(table).select("*").eq(column, value);
    return error ? `error ${error.code}` : data.length;
  };
  check(
    "A-04 anon reads no discoverable Judgment",
    await anonRows("judgments", "id", discoverable.id),
    0,
  );
  check("A-04 anon reads no canonical Case Law", await anonRows("case_law", "id", canonical.id), 0);
  check("A-04 anon reads no published Statute", await anonRows("statutes", "id", statute.id), 0);
  check(
    "A-04 anon reads no Statute provisions",
    await anonRows("statute_provisions", "statute_id", statute.id),
    0,
  );
  check(
    "A-04 anon reads no documents attached to library rows",
    await anonRows("documents", "file_name", `${MARK}.txt`),
    0,
  );
  {
    const { data, error } = await a.storage.from("documents").download(filePath);
    check("A-04 anon cannot download a discoverable Judgment's file", !data && !!error, true);
  }
  for (const table of [
    "legal_jurisdictions",
    "legal_authority_courts",
    "legal_case_categories",
    "legal_regional_groups",
    "docket_matter_categories",
    "court_non_sitting_days",
  ]) {
    const { data, error } = await a.from(table).select("*").limit(1);
    check(`A-04 anon reads no ${table}`, error ? `error ${error.code}` : data.length, 0);
  }
  for (const fn of ["can_view_judgment", "can_view_case_law", "can_view_statute"]) {
    const arg = {
      can_view_judgment: { p_judgment_id: discoverable.id },
      can_view_case_law: { p_case_law_id: canonical.id },
      can_view_statute: { p_statute_id: statute.id },
    }[fn];
    const { data } = await a.rpc(fn, arg);
    check(`A-04 ${fn} is false for anon`, data, false);
  }

  // The fix must not narrow what a signed-in magistrate reads.
  const readerRows = async (table, column, value) =>
    must(await readerClient.from(table).select("*").eq(column, value), `reader ${table}`).length;
  check(
    "A-04 control: a magistrate still reads the discoverable Judgment",
    await readerRows("judgments", "id", discoverable.id),
    1,
  );
  check(
    "A-04 control: a magistrate still reads canonical Case Law",
    await readerRows("case_law", "id", canonical.id),
    1,
  );
  check(
    "A-04 control: a magistrate still reads the published Statute",
    await readerRows("statutes", "id", statute.id),
    1,
  );
  check(
    "A-04 control: a magistrate still reads its provisions",
    await readerRows("statute_provisions", "statute_id", statute.id),
    1,
  );
  check(
    "A-04 control: a magistrate still reads the attached documents",
    await readerRows("documents", "file_name", `${MARK}.txt`),
    3,
  );
  {
    const { data } = await readerClient.storage.from("documents").download(filePath);
    check(
      "A-04 control: a magistrate still downloads the file",
      data ? await data.text() : null,
      SECRET,
    );
  }
  check(
    "A-04 control: a magistrate still reads reference tables",
    must(await readerClient.from("legal_jurisdictions").select("id").limit(1), "jurisdictions")
      .length,
    1,
  );

  // ---------- A-01: sign-up court_id is ignored; court access needs approval ----------
  const legacyCase = must(
    await admin
      .from("cases")
      .insert({
        court_id: courtB,
        case_number: `${MARK}-CN`,
        title: `${MARK} Court B case`,
        created_by: author.id,
      })
      .select("id")
      .single(),
    "legacy case",
  );
  created.cases.push(legacyCase.id);

  const applicantEmail = email("applicant");
  const signUp = await anon().auth.signUp({
    email: applicantEmail,
    password: PASSWORD,
    options: {
      data: {
        full_name: `${MARK} applicant`,
        requested_role: "magistrate",
        requested_court_ids: [courtB],
        court_id: courtB,
      },
    },
  });
  must(signUp, "real sign-up");
  const applicantId = signUp.data.user.id;
  created.users.push(applicantId);
  const applicantProfile = must(
    await admin.from("profiles").select("court_id, role").eq("id", applicantId).single(),
    "applicant profile",
  );
  check("A-01 sign-up court_id metadata is not stored", applicantProfile, {
    court_id: null,
    role: "magistrate",
  });
  const request = must(
    await admin
      .from("magistrate_court_requests")
      .select("id, court_id, status")
      .eq("profile_id", applicantId),
    "applicant request",
  );
  check(
    "A-01 the requested court still becomes one pending request",
    request.map((r) => [r.court_id, r.status]),
    [[courtB, "pending"]],
  );

  // A profile that already carries an unapproved court_id (as any account
  // created before 0160 could) gains nothing from it.
  must(
    await admin.from("profiles").update({ court_id: courtB }).eq("id", applicantId),
    "plant legacy court_id",
  );
  const applicantClient = await signIn(applicantEmail);
  const applicantCases = async () =>
    must(await applicantClient.from("cases").select("id").eq("id", legacyCase.id), "cases").length;
  check("A-01 an unapproved court_id reads no cases at that court", await applicantCases(), 0);
  {
    const { error } = await applicantClient.from("cases").insert({
      court_id: courtB,
      case_number: `${MARK}-PLANTED`,
      title: `${MARK} planted`,
      created_by: applicantId,
    });
    check("A-01 an unapproved court_id cannot create a case there", error?.code ?? null, "42501");
  }

  // The real approval flow still opens the court.
  must(
    await reviewerClient.rpc("decide_magistrate_court_request", {
      p_request_id: request[0].id,
      p_decision: "approved",
    }),
    "approve request",
  );
  check("A-01 after approval the court's cases are readable", await applicantCases(), 1);
  check(
    "A-01 after approval the magistrate reads the discoverable Judgment",
    must(
      await applicantClient.from("judgments").select("id").eq("id", discoverable.id),
      "approved judgments",
    ).length,
    1,
  );

  // ---------- A-03 / A-02: clerk access requests ----------
  const clerk = await createUser("clerk", { requested_role: "clerk" });
  const clerkClient = await signIn(clerk.email);
  const submit = (courtId) =>
    clerkClient.rpc("submit_clerk_access_request", { p_court_id: courtId });
  {
    const { error } = await submit(courtInactive);
    check(
      "A-03 a request against an inactive court is refused",
      error?.message ?? null,
      "Court not found or inactive",
    );
  }
  {
    const first = await submit(courtB);
    check("A-02 the first request is accepted", first.error?.message ?? null, null);
    const second = await submit(courtB);
    check(
      "A-02 a second request is refused in plain English",
      [second.error?.code, second.error?.message],
      ["P0001", "You already have a pending request for this court"],
    );
  }
  {
    const results = await Promise.all([submit(courtA), submit(courtA)]);
    const errors = results.map((r) => r.error).filter(Boolean);
    check(
      "A-02 a concurrent double submit creates exactly one request",
      results.length - errors.length,
      1,
    );
    check(
      "A-02 the losing concurrent submit gets the same sentence, not a raw 23505",
      errors.map((e) => [e.code, e.message]),
      [["P0001", "You already have a pending request for this court"]],
    );
  }

  // ---------- C-12 (anon part), plus the clerk RPC: anon cannot execute ----------
  for (const [fn, args] of [
    ["search_quick_codes", { p_query: "a", p_limit: 5 }],
    ["search_cases", { p_query: "a", p_limit: 5 }],
    ["submit_clerk_access_request", { p_court_id: courtB }],
  ]) {
    const { error } = await anon().rpc(fn, args);
    check(`anon cannot execute ${fn}`, error?.code ?? null, "42501");
  }
  for (const fn of ["search_quick_codes", "search_cases"]) {
    const { error } = await readerClient.rpc(fn, { p_query: "a", p_limit: 5 });
    check(`C-12 control: a magistrate still executes ${fn}`, error?.message ?? null, null);
  }
}

async function cleanup() {
  try {
    if (created.documents.length > 0)
      await admin.from("documents").delete().in("id", created.documents);
    if (created.objects.length > 0) await admin.storage.from("documents").remove(created.objects);
    if (created.judgments.length > 0)
      await admin.from("judgments").delete().in("id", created.judgments);
    if (created.caseLaw.length > 0) await admin.from("case_law").delete().in("id", created.caseLaw);
    if (created.statutes.length > 0) {
      await admin.from("statute_provisions").delete().in("statute_id", created.statutes);
      await admin.from("statutes").delete().in("id", created.statutes);
    }
    await admin.from("cases").delete().like("case_number", `${MARK}%`);
    if (created.courts.length > 0) {
      await admin.from("clerk_access_requests").delete().in("court_id", created.courts);
      await admin.from("magistrate_court_requests").delete().in("court_id", created.courts);
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
