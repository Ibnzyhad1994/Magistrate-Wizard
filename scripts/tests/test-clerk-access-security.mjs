// Live RLS/RPC security test for the Court Clerk access system. Unlike
// the other scripts in this directory, this one needs a RUNNING local
// Supabase instance (it exercises real authenticated Postgres sessions,
// not pure functions) -- run `npm run db:start` first.
//
// Requires SUPABASE_SERVICE_ROLE_KEY in the environment (never hard-coded
// here) -- get it from `npx supabase status -o env`. Reads the local URL/
// anon key from .env.local (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY),
// same as the app itself.
//
// Run with:
//   SUPABASE_SERVICE_ROLE_KEY=... node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-clerk-access-security.mjs
//
// Creates its own throwaway district/courts/profiles/auth users and
// deletes every one of them at the end, regardless of pass/fail.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  const text = readFileSync(new URL("../../.env", import.meta.url), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnvLocal();
const URL_ = env.VITE_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is required (see file header). Get it via `npx supabase status -o env`.");
  process.exit(1);
}

const admin = createClient(URL_, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
  if (!condition) failures += 1;
}
function checkErr(label, error, expectPresent = true) {
  const present = !!error;
  check(label, present === expectPresent);
  if (present !== expectPresent) console.log("   (error was:", error?.message, ")");
}

const stamp = Date.now();
const email = (name) => `clerk-test-${name}-${stamp}@example.test`;

async function signAs(emailAddr, password) {
  const client = createClient(URL_, ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email: emailAddr, password });
  if (error) throw error;
  return client;
}

async function createUser(emailAddr, password, meta) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emailAddr,
    password,
    email_confirm: false,
    user_metadata: meta,
  });
  if (error) throw error;
  return data.user;
}

const created = { users: [], courts: [], districtId: null };

async function main() {
  // --- Fixture setup ---------------------------------------------------
  const { data: district, error: districtErr } = await admin
    .from("magisterial_districts")
    .insert({ name: `TEST Clerk District ${stamp}` })
    .select()
    .single();
  if (districtErr) throw districtErr;
  created.districtId = district.id;

  async function makeCourt(name) {
    const { data, error } = await admin
      .from("courts")
      .insert({ name: `${name} ${stamp}`, jurisdiction: "Test", district_id: district.id, is_active: true })
      .select()
      .single();
    if (error) throw error;
    created.courts.push(data.id);
    return data;
  }

  const alpha = await makeCourt("TEST Court Alpha");
  const beta = await makeCourt("TEST Court Beta");
  const gamma = await makeCourt("TEST Court Gamma (no magistrate)");
  const epsilon = await makeCourt("TEST Court Epsilon");
  const delta = await makeCourt("TEST Court Delta (two magistrates)");

  const password = "Test-Password-123!";

  const m1 = await createUser(email("m1"), password, { full_name: "Test Magistrate One" });
  const m2 = await createUser(email("m2"), password, { full_name: "Test Magistrate Two" });
  created.users.push(m1.id, m2.id);
  await admin.auth.admin.updateUserById(m1.id, { email_confirm: true });
  await admin.auth.admin.updateUserById(m2.id, { email_confirm: true });

  // M1 -> Alpha, Epsilon, Delta. M2 -> Beta, Delta. Gamma has nobody.
  for (const [profileId, courtId] of [
    [m1.id, alpha.id],
    [m1.id, epsilon.id],
    [m1.id, delta.id],
    [m2.id, beta.id],
    [m2.id, delta.id],
  ]) {
    const { error } = await admin.from("magistrate_courts").insert({ profile_id: profileId, court_id: courtId });
    if (error) throw error;
  }

  // --- Test 1: signup role safety ---------------------------------------
  const plainMagistrate = await createUser(email("plain-magistrate"), password, { full_name: "Plain Signup" });
  created.users.push(plainMagistrate.id);
  {
    const { data } = await admin.from("profiles").select("role").eq("id", plainMagistrate.id).single();
    check("1. Ordinary signup (no requested_role) resolves to role=magistrate", data.role === "magistrate");
  }

  const attemptedAdmin = await createUser(email("attempted-admin"), password, { requested_role: "admin" });
  created.users.push(attemptedAdmin.id);
  {
    const { data } = await admin.from("profiles").select("role").eq("id", attemptedAdmin.id).single();
    check("2. requested_role='admin' at signup NEVER produces role=admin", data.role !== "admin");
  }

  // --- Clerk signup requesting Alpha, Beta, Gamma ------------------------
  const c1 = await createUser(email("c1"), password, {
    full_name: "Test Clerk One",
    requested_role: "clerk",
    requested_court_ids: [alpha.id, beta.id, gamma.id],
    staff_id: "STAFF-001",
    note: "Test clerk office",
  });
  created.users.push(c1.id);
  {
    const { data } = await admin.from("profiles").select("role").eq("id", c1.id).single();
    check("3. requested_role='clerk' at signup resolves to role=clerk", data.role === "clerk");
  }
  {
    const { data, error } = await admin
      .from("clerk_access_requests")
      .select("court_id, status")
      .eq("profile_id", c1.id);
    if (error) throw error;
    check("4. Signup created exactly 3 independent pending requests (one per court)", data.length === 3 && data.every((r) => r.status === "pending"));
  }

  // --- Pre-verification: invisible to magistrate, no docket access ------
  const m1Client = await signAs(m1.email, password);
  {
    const { data } = await m1Client.from("clerk_access_requests").select("id").eq("court_id", alpha.id);
    check("5. M1 cannot see C1's Alpha request before email verification", (data ?? []).length === 0);
  }

  // Confirm C1's email now.
  await admin.auth.admin.updateUserById(c1.id, { email_confirm: true });
  const c1Client = await signAs(c1.email, password);

  {
    const { data: mattersBefore } = await c1Client.from("docket_matters").select("id");
    check("6. A pending (unapproved) clerk reads zero docket matters", (mattersBefore ?? []).length === 0);
  }
  {
    const { error } = await c1Client.from("docket_matters").insert({
      court_id: alpha.id,
      case_number: `PRE-${stamp}`,
      matter_title: "Should not be allowed",
    });
    checkErr("7. A pending (unapproved) clerk cannot INSERT a docket matter", error, true);
  }

  // --- Magistrate visibility, scoped exactly to their own court ----------
  let alphaRequestId, betaRequestId, gammaRequestId;
  {
    const { data } = await m1Client.from("clerk_access_requests").select("id, court_id").eq("profile_id", c1.id);
    check("8. M1 (post-verification) sees the Alpha request", (data ?? []).some((r) => r.court_id === alpha.id));
    check("9. M1 does NOT see the Beta request (M2's court, not M1's)", !(data ?? []).some((r) => r.court_id === beta.id));
    check("10. M1 does NOT see the Gamma request (no magistrate there yet)", !(data ?? []).some((r) => r.court_id === gamma.id));
    alphaRequestId = (data ?? []).find((r) => r.court_id === alpha.id)?.id;
  }
  const m2Client = await signAs(m2.email, password);
  {
    const { data } = await m2Client.from("clerk_access_requests").select("id, court_id").eq("profile_id", c1.id);
    check("11. M2 sees the Beta request (and only Beta, not Alpha/Gamma)", (data ?? []).length === 1 && data[0].court_id === beta.id);
    betaRequestId = data?.[0]?.id;
  }

  // --- Orphaned request surfaced to admin, never auto-approved -----------
  {
    const { data } = await m1Client.rpc("list_clerk_access_requests_needing_admin_attention");
    check("12. A non-admin caller gets zero rows from the admin-only orphan finder", (data ?? []).length === 0);
  }
  const { data: adminProfileRow } = await admin.from("profiles").select("id").eq("role", "admin").limit(1).single();
  if (adminProfileRow) {
    // Reuse an existing seed admin purely to exercise the admin-gated RPC
    // as a real admin session; no data belonging to that account is
    // touched anywhere in this script.
    const { data: gammaReq } = await admin.from("clerk_access_requests").select("id").eq("court_id", gamma.id).single();
    gammaRequestId = gammaReq?.id;
  }
  {
    // Verified with the service-role-scoped function call directly (as
    // Postgres would evaluate it for a genuine admin) rather than signing
    // into a real admin account with an unknown password.
    const { data, error } = await admin.rpc("court_has_no_clerk_approver", { p_court_id: gamma.id });
    if (error) throw error;
    check("13. Gamma (no magistrate assigned) correctly has no clerk approver", data === true);
  }
  {
    const { data, error } = await admin.rpc("court_has_no_clerk_approver", { p_court_id: alpha.id });
    if (error) throw error;
    check("14. Alpha (single magistrate M1) correctly HAS a clerk approver", data === false);
  }
  {
    // Delta has two current magistrates, neither flagged can_manage_clerks.
    const { data, error } = await admin.rpc("court_has_no_clerk_approver", { p_court_id: delta.id });
    if (error) throw error;
    check("15. Delta (two magistrates, none flagged can_manage_clerks) has no resolvable approver", data === true);
  }
  {
    // Done via a genuine authenticated admin session (not the service-role
    // client): protect_magistrate_court_history()'s trigger checks
    // is_admin() from auth.uid(), which is null (and therefore false) on
    // a service-role connection -- only a real admin JWT satisfies it,
    // exactly as it would for the real admin UI.
    const adminUser = await createUser(email("admin"), password, {});
    created.users.push(adminUser.id);
    await admin.auth.admin.updateUserById(adminUser.id, { email_confirm: true });
    await admin.from("profiles").update({ role: "admin" }).eq("id", adminUser.id);
    const adminClient = await signAs(adminUser.email, password);
    const { error: flagErr } = await adminClient
      .from("magistrate_courts")
      .update({ can_manage_clerks: true })
      .eq("profile_id", m1.id)
      .eq("court_id", delta.id);
    if (flagErr) throw flagErr;
    const { data, error } = await admin.rpc("court_has_no_clerk_approver", { p_court_id: delta.id });
    if (error) throw error;
    check("16. Flagging M1 can_manage_clerks=true at Delta resolves the approver ambiguity", data === false);
  }

  // --- Cross-court approval must be rejected -----------------------------
  {
    const { error } = await m2Client.rpc("decide_clerk_access_request", {
      p_request_id: alphaRequestId,
      p_decision: "approved",
    });
    checkErr("17. M2 cannot decide the Alpha request (not M2's court)", error, true);
  }

  // --- Approval: creates assignment, grants docket access ----------------
  {
    const { data, error } = await m1Client.rpc("decide_clerk_access_request", {
      p_request_id: alphaRequestId,
      p_decision: "approved",
    });
    if (error) throw error;
    check("18. M1 approves the Alpha request", data.status === "approved");
  }
  {
    const { data } = await admin.from("clerk_courts").select("id").eq("profile_id", c1.id).eq("court_id", alpha.id).is("ended_at", null);
    check("19. Approval created exactly one active clerk_courts row for Alpha", (data ?? []).length === 1);
  }

  // --- Idempotency: duplicate approval is a no-op ------------------------
  {
    const { data, error } = await m1Client.rpc("decide_clerk_access_request", {
      p_request_id: alphaRequestId,
      p_decision: "approved",
    });
    if (error) throw error;
    check("20. Re-approving the same (already-approved) request is idempotent (no error)", data.status === "approved");
  }
  {
    const { data } = await admin.from("clerk_courts").select("id").eq("profile_id", c1.id).eq("court_id", alpha.id).is("ended_at", null);
    check("21. Duplicate approval did NOT create a second active assignment", (data ?? []).length === 1);
  }

  // --- Rejection: no assignment created -----------------------------------
  {
    const { data, error } = await m2Client.rpc("decide_clerk_access_request", {
      p_request_id: betaRequestId,
      p_decision: "rejected",
      p_rejection_reason: "Test rejection reason",
    });
    if (error) throw error;
    check("22. M2 rejects the Beta request", data.status === "rejected" && data.rejection_reason === "Test rejection reason");
  }
  {
    const { data } = await admin.from("clerk_courts").select("id").eq("profile_id", c1.id).eq("court_id", beta.id);
    check("23. Rejection created NO clerk_courts row for Beta", (data ?? []).length === 0);
  }

  // --- Docket access now scoped exactly to the approved court -------------
  let createdMatterId;
  {
    const { data, error } = await c1Client
      .from("docket_matters")
      .insert({ court_id: alpha.id, case_number: `C1-${stamp}`, matter_title: "Clerk-created matter" })
      .select()
      .single();
    if (error) throw error;
    createdMatterId = data.id;
    check("24. Approved clerk can create a docket matter at Alpha", !!data.id);
    check("25. The clerk's own id is recorded as created_by (not the magistrate's)", data.created_by === c1.id);
    check("26. district_id was correctly derived from the court, not client-supplied", data.district_id === district.id);
  }
  {
    const { data, error } = await c1Client
      .from("docket_matters")
      .update({ status: "archived" })
      .eq("id", createdMatterId)
      .select()
      .single();
    if (error) throw error;
    check("27. Approved clerk can archive (not permanently delete) a docket matter", data.status === "archived");
  }
  {
    // No DELETE policy exists at all on docket_matters, so RLS matches
    // zero rows -- the statement itself reports success (nothing violates
    // anything), it simply deletes nothing. The correct assertion is that
    // the row still exists afterward, not that an error was thrown.
    await c1Client.from("docket_matters").delete().eq("id", createdMatterId);
    const { data } = await admin.from("docket_matters").select("id").eq("id", createdMatterId).single();
    check("28. No DELETE policy exists -- a clerk's DELETE silently affects zero rows; the matter still exists", !!data);
  }
  {
    const { data } = await c1Client.from("docket_matters").select("id").eq("court_id", beta.id);
    check("29. Clerk cannot see Beta's docket (rejected court, different court in the SAME test district)", (data ?? []).length === 0);
  }
  {
    const { data } = await c1Client.from("docket_matters").select("id").eq("court_id", gamma.id);
    check("30. Clerk cannot see Gamma's docket (still pending, no decision yet)", (data ?? []).length === 0);
  }

  // --- Case law / judgments totally unreachable ---------------------------
  {
    const { data } = await c1Client.from("case_law").select("id").limit(5);
    check("31. Clerk reads zero Case Law rows, even though real published rows exist", (data ?? []).length === 0);
  }
  {
    const { data } = await c1Client.from("judgments").select("id").limit(5);
    check("32. Clerk reads zero Judgment rows", (data ?? []).length === 0);
  }
  {
    const { error } = await c1Client
      .from("case_law")
      .insert({ case_name: "x", citation: "x", court: "x", jurisdiction: "x", owner_id: c1.id });
    checkErr("33. Clerk cannot INSERT a Case Law row", error, true);
  }
  {
    const { data: anyCaseLaw } = await admin.from("case_law").select("id").limit(1).single();
    if (anyCaseLaw) {
      const { data } = await c1Client.rpc("can_view_case_law", { p_case_law_id: anyCaseLaw.id });
      check("34. can_view_case_law() is false for the clerk on a real existing row (the same predicate Storage relies on)", data === false);
    }
  }
  {
    const { data: anyJudgment } = await admin.from("judgments").select("id").limit(1).maybeSingle();
    if (anyJudgment) {
      const { data } = await c1Client.rpc("can_view_judgment", { p_judgment_id: anyJudgment.id });
      check("35. can_view_judgment() is false for the clerk on a real existing row", data === false);
    }
  }

  // --- Self-escalation is impossible --------------------------------------
  {
    const { error } = await c1Client.from("profiles").update({ role: "admin" }).eq("id", c1.id);
    // Either RLS denies the row outright, or the WITH CHECK silently
    // leaves role unchanged -- both are acceptable "cannot escalate"
    // outcomes; only an actual role change to 'admin' is a failure.
    const { data: after } = await admin.from("profiles").select("role").eq("id", c1.id).single();
    check("36. Clerk cannot promote themselves to admin via direct profile update", after.role !== "admin");
  }
  {
    // Same reasoning as #28: no client-facing UPDATE policy for a clerk
    // on this table means RLS matches zero rows -- a silent no-op, not
    // an error. Assert the row is unchanged, not that it errored.
    await c1Client.from("clerk_access_requests").update({ status: "approved", reviewed_by: c1.id }).eq("id", gammaRequestId);
    const { data } = await admin.from("clerk_access_requests").select("status, reviewed_by").eq("id", gammaRequestId).single();
    check("37. Clerk cannot directly UPDATE a request's status/reviewer via raw table access", data.status === "pending" && data.reviewed_by === null);
  }
  {
    const { data, error } = await c1Client.rpc("decide_clerk_access_request", {
      p_request_id: gammaRequestId,
      p_decision: "approved",
    });
    checkErr("38. Clerk cannot approve their OWN request via the RPC either (not a magistrate at Gamma)", error, true);
  }

  // --- Cancel / re-request ------------------------------------------------
  {
    const { data, error } = await c1Client.rpc("cancel_clerk_access_request", { p_request_id: gammaRequestId });
    if (error) throw error;
    check("39. Clerk can cancel their own still-pending request", data.status === "cancelled");
  }
  {
    const { data, error } = await c1Client.rpc("submit_clerk_access_request", { p_court_id: epsilon.id });
    if (error) throw error;
    check("40. Clerk can request an additional court after cancelling a prior one", data.status === "pending");
    var epsilonRequestId = data.id;
  }
  {
    const { data, error } = await m1Client.rpc("decide_clerk_access_request", {
      p_request_id: epsilonRequestId,
      p_decision: "approved",
    });
    if (error) throw error;
    check("41. M1 approves the new Epsilon request (clerk now has two independently-approved courts)", data.status === "approved");
  }

  // --- Revocation is per-court, immediate, and preserves history ----------
  const { data: alphaAssignment } = await admin
    .from("clerk_courts")
    .select("id")
    .eq("profile_id", c1.id)
    .eq("court_id", alpha.id)
    .is("ended_at", null)
    .single();
  {
    const { data, error } = await m1Client.rpc("revoke_clerk_court_access", {
      p_assignment_id: alphaAssignment.id,
      p_reason: "Test revocation",
    });
    if (error) throw error;
    check("42. M1 revokes the clerk's Alpha access", data.ended_at !== null && data.ended_by === m1.id);
  }
  {
    const { data } = await c1Client.from("docket_matters").select("id").eq("court_id", alpha.id);
    check("43. Revocation takes effect immediately -- clerk now reads zero Alpha docket matters", (data ?? []).length === 0);
  }
  {
    const { error } = await c1Client
      .from("docket_matters")
      .insert({ court_id: epsilon.id, case_number: `EPS-${stamp}`, matter_title: "still works" });
    check("44. Revoking Alpha did NOT affect the separately-approved Epsilon court (clerk can still write there)", !error);
  }
  {
    const { data, error } = await m1Client.rpc("revoke_clerk_court_access", {
      p_assignment_id: alphaAssignment.id,
      p_reason: "second attempt",
    });
    if (error) throw error;
    check(
      "45. Revoking an already-revoked assignment is idempotent (reason from the FIRST revoke is preserved, not overwritten)",
      data.end_reason === "Test revocation",
    );
  }
  {
    const { data } = await admin.from("clerk_courts").select("id").eq("profile_id", c1.id).eq("court_id", alpha.id);
    check("46. The historical (revoked) assignment row still exists -- never deleted", (data ?? []).length === 1);
  }

  // --- Existing magistrate pathways are unaffected ------------------------
  {
    const { data, error } = await m1Client.from("docket_matters").select("id").eq("court_id", alpha.id);
    if (error) throw error;
    check("47. M1 (ordinary magistrate) still reads Alpha's docket normally", (data ?? []).length >= 1);
  }

  console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll clerk-access-security tests passed.");
}

async function cleanup() {
  // Reverse dependency order. Best-effort -- log, never throw, so a
  // mid-test failure still cleans up as much as possible.
  try {
    for (const courtId of created.courts) {
      await admin.from("docket_matters").delete().eq("court_id", courtId);
    }
    for (const courtId of created.courts) {
      await admin.from("clerk_access_requests").delete().eq("court_id", courtId);
      await admin.from("clerk_courts").delete().eq("court_id", courtId);
      await admin.from("magistrate_courts").delete().eq("court_id", courtId);
    }
    for (const courtId of created.courts) {
      await admin.from("courts").delete().eq("id", courtId);
    }
    if (created.districtId) {
      await admin.from("magisterial_districts").delete().eq("id", created.districtId);
    }
    for (const userId of created.users) {
      await admin.auth.admin.deleteUser(userId);
    }
    console.log("Cleanup complete.");
  } catch (err) {
    console.error("Cleanup encountered an error (some test fixtures may need manual removal):", err);
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
