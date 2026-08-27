// Live RLS/RPC regression test for the "Administrator who is also a
// magistrate must reach the Docket through their magistrate_courts
// assignments, and NEVER through a universal admin bypass" fix.
//
// Background: the Docket route's ProtectedRoute previously used
// allowedRoles={["magistrate", "clerk"]}, which silently excluded
// role='admin' -- even an admin with fully active magistrate_courts
// assignments got redirected to /unauthorized before any court-
// assignment check ever ran. The fix removed that role allowlist from
// the Docket route entirely (see router.tsx); real authorization stays
// exactly as it always was -- can_access_court() / has_retained_-
// assignment() / has_docket_share() / has_active_clerk_assignment(),
// composed with NO admin branch anywhere. This script proves that DB
// layer empirically, from both directions: an admin WITH an assignment
// gets in, an admin WITHOUT one does NOT (no bypass), and plain
// magistrate/clerk behavior is unaffected.
//
// Run with:
//   SUPABASE_SERVICE_ROLE_KEY=... node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-admin-magistrate-docket-access.mjs
//
// Creates its own throwaway district/courts/profiles/auth users and
// deletes every one of them at the end, regardless of pass/fail.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  const text = readFileSync(new URL("../../.env", import.meta.url), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnv();
const URL_ = env.VITE_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is required — see file header.");
  process.exit(1);
}

const admin = createClient(URL_, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
  if (!condition) failures += 1;
}

const stamp = Date.now();
const email = (name) => `admin-docket-access-${name}-${stamp}@example.test`;
const password = "Test-Password-123!";

async function signAs(emailAddr) {
  const client = createClient(URL_, ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email: emailAddr, password });
  if (error) throw error;
  return client;
}
async function createUser(emailAddr, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emailAddr,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  // profiles.role defaults to 'magistrate' via handle_new_user() -- set the
  // exact role this fixture needs directly, same as an admin-provisioned
  // account would end up, never via client-supplied signup metadata.
  const { error: roleErr } = await admin.from("profiles").update({ role }).eq("id", data.user.id);
  if (roleErr) throw roleErr;
  return data.user;
}

const created = { users: [], courts: [], districtId: null };

async function main() {
  const { data: district, error: districtErr } = await admin
    .from("magisterial_districts")
    .insert({ name: `TEST Admin-Docket District ${stamp}` })
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

  const alpha = await makeCourt("TEST Admin-Docket Alpha Court");
  const beta = await makeCourt("TEST Admin-Docket Beta Court");

  // Admin who IS also the assigned magistrate at Alpha -- the exact
  // real-world shape of the regression report.
  const adminMagistrate = await createUser(email("admin-magistrate"), "admin");
  created.users.push(adminMagistrate.id);
  const now = new Date().toISOString();
  await admin.from("magistrate_courts").insert({
    profile_id: adminMagistrate.id,
    court_id: alpha.id,
    assignment_type: "regular",
    started_at: now,
  });

  // A pure platform admin with ZERO court assignments -- must NOT get any
  // Docket access at all, proving there is no universal admin bypass.
  const pureAdmin = await createUser(email("pure-admin"), "admin");
  created.users.push(pureAdmin.id);

  // Regression controls: an ordinary magistrate and an approved clerk,
  // unaffected by this fix, at Beta only.
  const magistrate = await createUser(email("magistrate"), "magistrate");
  created.users.push(magistrate.id);
  await admin.from("magistrate_courts").insert({
    profile_id: magistrate.id,
    court_id: beta.id,
    assignment_type: "regular",
    started_at: now,
  });

  const clerk = await createUser(email("clerk"), "clerk");
  created.users.push(clerk.id);
  await admin.from("clerk_courts").insert({
    profile_id: clerk.id,
    court_id: beta.id,
    approved_by: magistrate.id,
    started_at: now,
  });

  const adminMagistrateClient = await signAs(adminMagistrate.email);
  const pureAdminClient = await signAs(pureAdmin.email);
  const magistrateClient = await signAs(magistrate.email);
  const clerkClient = await signAs(clerk.email);

  // Seeded through the actual authenticated clients (not the service-role
  // admin client) so docket_matters_guard()'s created_by := auth.uid()
  // records the real seeding user, exactly like a genuine insert would.
  const { data: alphaMatter, error: aErr } = await adminMagistrateClient
    .from("docket_matters")
    .insert({ court_id: alpha.id, case_number: `ADM-A-${stamp}`, matter_title: "Alpha matter" })
    .select()
    .single();
  if (aErr) throw aErr;
  const { data: betaMatter, error: bErr } = await magistrateClient
    .from("docket_matters")
    .insert({ court_id: beta.id, case_number: `ADM-B-${stamp}`, matter_title: "Beta matter" })
    .select()
    .single();
  if (bErr) throw bErr;

  // --- 1. Admin WITH an active magistrate_courts assignment -----------
  {
    const { data } = await adminMagistrateClient
      .from("magistrate_courts")
      .select("court_id")
      .eq("profile_id", adminMagistrate.id)
      .is("ended_at", null);
    check("1a. Admin-magistrate's own magistrate_courts query returns exactly Alpha (this is what useMyCurrentCourts() reads)", (data ?? []).length === 1 && data[0].court_id === alpha.id);
  }
  {
    const { data } = await adminMagistrateClient.from("docket_matters").select("id").eq("court_id", alpha.id);
    check("1b. Admin-magistrate can read the Alpha docket (whole-court access via assignment, not via role)", (data ?? []).some((r) => r.id === alphaMatter.id));
  }
  {
    const { data, error } = await adminMagistrateClient
      .from("docket_matters")
      .insert({ court_id: alpha.id, case_number: `ADM-A2-${stamp}`, matter_title: "Second Alpha matter" })
      .select()
      .single();
    check("1c. Admin-magistrate can create a new matter at Alpha", !error && !!data);
    check("1d. created_by correctly records the admin-magistrate's own id, not a spoofed value", data?.created_by === adminMagistrate.id);
  }
  {
    const { data } = await adminMagistrateClient.from("docket_matters").select("id").eq("court_id", beta.id);
    check("1e. Admin-magistrate CANNOT read the Beta docket (Alpha assignment does not grant unrelated courts)", (data ?? []).length === 0);
  }
  {
    const { error } = await adminMagistrateClient
      .from("docket_matters")
      .insert({ court_id: beta.id, case_number: `ADM-B2-${stamp}`, matter_title: "Should fail" });
    check("1f. Admin-magistrate cannot insert into Beta (no assignment there — no admin bypass on INSERT)", !!error);
  }

  // --- 2. Pure admin with ZERO court assignments -- no universal bypass ---
  {
    const { data } = await pureAdminClient
      .from("magistrate_courts")
      .select("court_id")
      .eq("profile_id", pureAdmin.id)
      .is("ended_at", null);
    check("2a. Pure admin's own magistrate_courts query returns an empty array, not an error (accurate 'no assignment' state)", Array.isArray(data) && data.length === 0);
  }
  {
    const { data } = await pureAdminClient.from("docket_matters").select("id").eq("court_id", alpha.id);
    check("2b. Pure admin CANNOT read the Alpha docket — role='admin' alone grants nothing", (data ?? []).length === 0);
  }
  {
    const { data } = await pureAdminClient.from("docket_matters").select("id").eq("court_id", beta.id);
    check("2c. Pure admin CANNOT read the Beta docket either — confirms no universal admin bypass exists anywhere", (data ?? []).length === 0);
  }
  {
    const { data, error } = await pureAdminClient.rpc("list_docket_matters", { p_court_id: null });
    if (error) throw error;
    check("2d. Pure admin's list_docket_matters (All My Courts) returns zero rows, not an error and not every court's matters", data.length === 0);
  }

  // --- 3. Regression controls: ordinary magistrate and approved clerk ---
  {
    const { data } = await magistrateClient.from("docket_matters").select("id").eq("court_id", beta.id);
    check("3a. Ordinary magistrate (unaffected by this fix) still reads Beta normally", (data ?? []).some((r) => r.id === betaMatter.id));
  }
  {
    const { data } = await magistrateClient.from("docket_matters").select("id").eq("court_id", alpha.id);
    check("3b. Ordinary magistrate still cannot read Alpha (not their court)", (data ?? []).length === 0);
  }
  {
    const { data } = await clerkClient.from("docket_matters").select("id").eq("court_id", beta.id);
    check("4a. Approved clerk (unaffected by this fix) still reads Beta normally", (data ?? []).some((r) => r.id === betaMatter.id));
  }
  {
    const { data } = await clerkClient.from("docket_matters").select("id").eq("court_id", alpha.id);
    check("4b. Clerk restrictions remain fully intact — clerk still cannot read Alpha, still no cross-court leak", (data ?? []).length === 0);
  }
  {
    // A clerk must never acquire admin/magistrate powers as a side effect of this fix.
    const { data: clerkProfile } = await admin.from("profiles").select("role").eq("id", clerk.id).single();
    check("4c. Clerk's stored role is unchanged ('clerk'), no privilege drift from this fix", clerkProfile.role === "clerk");
  }

  console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll admin-magistrate docket access tests passed.");
}

async function cleanup() {
  try {
    for (const courtId of created.courts) {
      await admin.from("docket_matters").delete().eq("court_id", courtId);
      await admin.from("clerk_courts").delete().eq("court_id", courtId);
      await admin.from("magistrate_courts").delete().eq("court_id", courtId);
    }
    for (const courtId of created.courts) {
      await admin.from("courts").delete().eq("id", courtId);
    }
    if (created.districtId) await admin.from("magisterial_districts").delete().eq("id", created.districtId);
    for (const userId of created.users) {
      await admin.auth.admin.deleteUser(userId);
    }
    console.log("Cleanup complete.");
  } catch (err) {
    console.error("Cleanup encountered an error (some fixtures may need manual removal):", err);
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
