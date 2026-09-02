// Live RLS/RPC security test for the two-level Docket (All My Courts /
// one specific court). Needs a running local Supabase instance (`npm run
// db:start`) and SUPABASE_SERVICE_ROLE_KEY in the environment.
//
// Run with:
//   SUPABASE_SERVICE_ROLE_KEY=... node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-docket-two-level-scope.mjs
//
// Creates its own throwaway district/courts/profiles/matters and deletes
// every one of them at the end, regardless of pass/fail.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  const text = readFileSync(new URL("../../.env", import.meta.url), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
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
function checkErr(label, error, expectPresent = true) {
  const present = !!error;
  check(label, present === expectPresent);
  if (present !== expectPresent) console.log("   (error:", error?.message, ")");
}

const stamp = Date.now();
const email = (name) => `docket-scope-${name}-${stamp}@example.test`;
const password = "Test-Password-123!";

async function signAs(emailAddr) {
  const client = createClient(URL_, ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email: emailAddr, password });
  if (error) throw error;
  return client;
}
async function createUser(emailAddr, meta = {}) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emailAddr,
    password,
    email_confirm: true,
    user_metadata: meta,
  });
  if (error) throw error;
  return data.user;
}

const created = { users: [], courts: [], districtId: null, matters: [] };

async function main() {
  const { data: district, error: districtErr } = await admin
    .from("magisterial_districts")
    .insert({ name: `TEST Scope District ${stamp}` })
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

  const alpha = await makeCourt("TEST Alpha Court");
  const beta = await makeCourt("TEST Beta Court");
  const outsider = await makeCourt("TEST Outsider Court"); // magistrate has NO access here

  const magistrate = await createUser(email("magistrate"), {});
  created.users.push(magistrate.id);
  await admin.from("magistrate_courts").insert([
    { profile_id: magistrate.id, court_id: alpha.id },
    { profile_id: magistrate.id, court_id: beta.id },
  ]);

  const clerkAlpha = await createUser(email("clerk-alpha"), { requested_role: "clerk" });
  const clerkBeta = await createUser(email("clerk-beta"), { requested_role: "clerk" });
  const clerkBoth = await createUser(email("clerk-both"), { requested_role: "clerk" });
  created.users.push(clerkAlpha.id, clerkBeta.id, clerkBoth.id);
  const now = new Date().toISOString();
  await admin.from("clerk_courts").insert([
    { profile_id: clerkAlpha.id, court_id: alpha.id, approved_by: magistrate.id, started_at: now },
    { profile_id: clerkBeta.id, court_id: beta.id, approved_by: magistrate.id, started_at: now },
    { profile_id: clerkBoth.id, court_id: alpha.id, approved_by: magistrate.id, started_at: now },
    { profile_id: clerkBoth.id, court_id: beta.id, approved_by: magistrate.id, started_at: now },
  ]);

  const magClient = await signAs(magistrate.email);
  const clerkAlphaClient = await signAs(clerkAlpha.email);
  const clerkBetaClient = await signAs(clerkBeta.email);
  const clerkBothClient = await signAs(clerkBoth.email);

  // --- 1/2: magistrate sees both courts, All My Courts is the union ------
  {
    const { data } = await admin
      .from("magistrate_courts")
      .select("court_id")
      .eq("profile_id", magistrate.id)
      .is("ended_at", null);
    check("1. Magistrate's active court assignments include both Alpha and Beta", new Set(data.map((r) => r.court_id)).size === 2);
  }

  // Create matters directly (as magistrate) at Alpha and Beta.
  const { data: alphaMatter, error: aErr } = await magClient
    .from("docket_matters")
    .insert({ court_id: alpha.id, case_number: `A-${stamp}`, matter_title: "Alpha matter" })
    .select()
    .single();
  if (aErr) throw aErr;
  created.matters.push(alphaMatter.id);

  const { data: betaMatter, error: bErr } = await magClient
    .from("docket_matters")
    .insert({ court_id: beta.id, case_number: `B-${stamp}`, matter_title: "Beta matter" })
    .select()
    .single();
  if (bErr) throw bErr;
  created.matters.push(betaMatter.id);

  {
    const { data, error } = await magClient.rpc("list_docket_matters", { p_court_id: null });
    if (error) throw error;
    const ids = new Set(data.map((r) => r.id));
    check("2. All My Courts (p_court_id=null) includes both the Alpha and Beta matter", ids.has(alphaMatter.id) && ids.has(betaMatter.id));
    check("3. Every combined-view row has a non-empty court_name", data.every((r) => !!r.court_name));
  }

  // --- 4/5: scoped to one court excludes the other -----------------------
  {
    const { data, error } = await magClient.rpc("list_docket_matters", { p_court_id: alpha.id });
    if (error) throw error;
    const ids = new Set(data.map((r) => r.id));
    check("4. Scoped to Alpha shows the Alpha matter", ids.has(alphaMatter.id));
    check("4b. Scoped to Alpha does NOT show the Beta matter", !ids.has(betaMatter.id));
  }
  {
    const { data, error } = await magClient.rpc("list_docket_matters", { p_court_id: beta.id });
    if (error) throw error;
    const ids = new Set(data.map((r) => r.id));
    check("5. Scoped to Beta shows the Beta matter", ids.has(betaMatter.id));
    check("5b. Scoped to Beta does NOT show the Alpha matter", !ids.has(alphaMatter.id));
  }

  // --- 6: export (get_daily_docket_report_data) respects scope -----------
  // (indirect check: p_court_id filters the same underlying table, same predicate shape)
  {
    const { data, error } = await magClient.rpc("get_daily_docket_report_data", {
      p_date: "1900-01-01",
      p_court_id: alpha.id,
    });
    if (error) throw error;
    check("6. Court-scoped export accepts p_court_id without error (no matching date -> empty, not an error)", Array.isArray(data));
  }

  // --- 7/8: create respects/derives court context; unauthorized court is rejected ---
  {
    const { error } = await magClient
      .from("docket_matters")
      .insert({ court_id: outsider.id, case_number: `X-${stamp}`, matter_title: "Should fail" });
    checkErr("7/9/10. Magistrate cannot insert a matter into a court they have no access to (RLS)", error, true);
  }

  // --- 11: ordinary edit cannot change court_id ---------------------------
  {
    const { error } = await magClient
      .from("docket_matters")
      .update({ court_id: beta.id })
      .eq("id", alphaMatter.id);
    checkErr("11. Ordinary update cannot change court_id (docket_matters_guard, 0097)", error, true);
    const { data: stillAlpha } = await admin.from("docket_matters").select("court_id").eq("id", alphaMatter.id).single();
    check("11b. The matter's court_id is unchanged after the rejected attempt", stillAlpha.court_id === alpha.id);
  }

  // --- 12/13: clerk cross-court isolation --------------------------------
  {
    const { data } = await clerkAlphaClient.from("docket_matters").select("id").eq("court_id", alpha.id);
    check("12. Alpha clerk sees the Alpha matter", (data ?? []).some((r) => r.id === alphaMatter.id));
  }
  {
    const { data } = await clerkAlphaClient.from("docket_matters").select("id").eq("court_id", beta.id);
    check("12b. Alpha clerk sees ZERO Beta matters (direct court_id query)", (data ?? []).length === 0);
  }
  {
    const { data, error } = await clerkAlphaClient.rpc("list_docket_matters", { p_court_id: beta.id });
    if (error) throw error;
    check("12c. Alpha clerk's list_docket_matters(p_court_id=Beta) returns zero rows, not an error", data.length === 0);
  }
  {
    const { data, error } = await clerkAlphaClient.rpc("list_docket_matters", { p_court_id: null });
    if (error) throw error;
    const ids = new Set(data.map((r) => r.id));
    check("12d. Alpha clerk's own All My Courts contains Alpha, not Beta", ids.has(alphaMatter.id) && !ids.has(betaMatter.id));
  }
  {
    const { error } = await clerkAlphaClient
      .from("docket_matters")
      .update({ matter_title: "hacked" })
      .eq("id", betaMatter.id);
    // RLS denies -> zero rows matched -> no error, but also no change.
    const { data: unchanged } = await admin.from("docket_matters").select("matter_title").eq("id", betaMatter.id).single();
    check("13. Alpha clerk cannot modify the Beta matter (silently affects zero rows)", unchanged.matter_title === "Beta matter", !error || true);
  }
  {
    const { data } = await clerkBetaClient.from("docket_matters").select("id").eq("court_id", alpha.id);
    check("13b. Beta clerk sees ZERO Alpha matters", (data ?? []).length === 0);
  }

  // --- 14: clerk approved for both can use both ---------------------------
  {
    const { data, error } = await clerkBothClient.rpc("list_docket_matters", { p_court_id: null });
    if (error) throw error;
    const ids = new Set(data.map((r) => r.id));
    check("14. Clerk approved for both courts sees both matters via All My Courts", ids.has(alphaMatter.id) && ids.has(betaMatter.id));
  }

  // --- 15: revocation is immediate -----------------------------------------
  {
    const { data: assignment } = await admin
      .from("clerk_courts")
      .select("id")
      .eq("profile_id", clerkAlpha.id)
      .eq("court_id", alpha.id)
      .single();
    await magClient.rpc("revoke_clerk_court_access", { p_assignment_id: assignment.id });
    const { data } = await clerkAlphaClient.from("docket_matters").select("id").eq("court_id", alpha.id);
    check("15. Revoked Alpha clerk immediately loses access to the Alpha matter", (data ?? []).length === 0);
  }

  // --- 16: search does not leak an unauthorized matter's existence --------
  {
    const { data, error } = await clerkBetaClient.rpc("search_docket_matters", { p_query: "Alpha", p_limit: 10 });
    if (error) throw error;
    check("16. Beta clerk's search for 'Alpha' returns nothing (no title/case-number leak)", data.length === 0);
  }

  // --- 18: child records follow the parent matter's court ----------------
  {
    const { data: event, error } = await clerkBothClient
      .from("docket_events")
      .insert({
        docket_matter_id: alphaMatter.id,
        scheduled_date: "2030-01-01",
        event_type: "mention",
        created_by: clerkBoth.id,
      })
      .select()
      .single();
    if (error) throw error;
    check("18. A clerk approved for Alpha can create a docket_event on the Alpha matter", !!event.id);
    const { data: seenByBetaOnly } = await clerkBetaClient.from("docket_events").select("id").eq("id", event.id);
    check("18b. Beta-only clerk cannot see that Alpha event (child follows parent's court)", (seenByBetaOnly ?? []).length === 0);
  }

  // --- 23: concurrency — a stale update is rejected, not silently applied ---
  {
    const { data: fresh } = await admin.from("docket_matters").select("updated_at").eq("id", betaMatter.id).single();
    // Someone else updates it first.
    await magClient.from("docket_matters").update({ outcome: "first save" }).eq("id", betaMatter.id);
    // A stale editor (still holding the OLD updated_at) tries to save.
    const { data: staleAttempt } = await magClient
      .from("docket_matters")
      .update({ outcome: "stale overwrite attempt" })
      .eq("id", betaMatter.id)
      .eq("updated_at", fresh.updated_at)
      .select()
      .maybeSingle();
    check("23. A stale conditional update (old updated_at) matches zero rows, not a silent overwrite", staleAttempt === null);
    const { data: finalRow } = await admin.from("docket_matters").select("outcome").eq("id", betaMatter.id).single();
    check("23b. The first (non-stale) save is the one that stuck", finalRow.outcome === "first save");
  }

  // --- 25/26: district-scoped uniqueness + archive-not-delete still work ---
  {
    const { error } = await magClient
      .from("docket_matters")
      .insert({ court_id: alpha.id, case_number: `A-${stamp}`, matter_title: "Duplicate case number" });
    checkErr("25. District-scoped case-number uniqueness is still enforced", error, true);
  }
  {
    const { data, error } = await magClient
      .from("docket_matters")
      .update({ status: "archived" })
      .eq("id", alphaMatter.id)
      .select()
      .single();
    if (error) throw error;
    check("26. Archive (status update) still works", data.status === "archived");
    const { error: delError } = await magClient.from("docket_matters").delete().eq("id", alphaMatter.id);
    const { data: stillThere } = await admin.from("docket_matters").select("id").eq("id", alphaMatter.id).maybeSingle();
    check("26b. Permanent delete remains blocked (no DELETE policy — row still exists)", !!stillThere, !delError || true);
  }

  console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll docket two-level scope tests passed.");
}

async function cleanup() {
  try {
    for (const courtId of created.courts) {
      await admin.from("docket_events").delete().in(
        "docket_matter_id",
        (await admin.from("docket_matters").select("id").eq("court_id", courtId)).data?.map((r) => r.id) ?? [],
      );
      await admin.from("docket_matters").delete().eq("court_id", courtId);
      await admin.from("clerk_courts").delete().eq("court_id", courtId);
      await admin.from("clerk_access_requests").delete().eq("court_id", courtId);
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
