// Live RLS/RPC test for Docket identity updates, bin, restore, and
// 7-day hard purge (0120). Needs a running local Supabase instance
// (`npm run db:start`) and SUPABASE_SERVICE_ROLE_KEY in the environment
// or .env.
//
// Run with:
//   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-docket-matter-bin-purge.mjs

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
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
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
const email = (name) => `docket-bin-${name}-${stamp}@example.test`;
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

const created = { users: [], courts: [], districtId: null };

async function main() {
  const { data: district, error: districtErr } = await admin
    .from("magisterial_districts")
    .insert({ name: `TEST Bin District ${stamp}` })
    .select()
    .single();
  if (districtErr) throw districtErr;
  created.districtId = district.id;

  const { data: court, error: courtErr } = await admin
    .from("courts")
    .insert({ name: `TEST Bin Court ${stamp}`, jurisdiction: "Test", district_id: district.id, is_active: true })
    .select()
    .single();
  if (courtErr) throw courtErr;
  created.courts.push(court.id);

  const { data: otherCourt, error: otherCourtErr } = await admin
    .from("courts")
    .insert({ name: `TEST Bin Other Court ${stamp}`, jurisdiction: "Test", district_id: district.id, is_active: true })
    .select()
    .single();
  if (otherCourtErr) throw otherCourtErr;
  created.courts.push(otherCourt.id);

  const magistrate = await createUser(email("magistrate"), {});
  const viewer = await createUser(email("viewer"), {});
  created.users.push(magistrate.id, viewer.id);
  await admin.from("magistrate_courts").insert({ profile_id: magistrate.id, court_id: court.id });

  const magClient = await signAs(magistrate.email);
  const viewerClient = await signAs(viewer.email);

  const { data: matter, error: createErr } = await magClient
    .from("docket_matters")
    .insert({ court_id: court.id, case_number: `BIN-${stamp}`, matter_title: "Original title", charge_or_issue: "Theft" })
    .select()
    .single();
  if (createErr) throw createErr;

  {
    const { data, error } = await magClient
      .from("docket_matters")
      .update({ case_number: `BIN-${stamp}-R`, matter_title: "Retitled matter", charge_or_issue: "Assault" })
      .eq("id", matter.id)
      .select()
      .single();
    checkErr("1. Magistrate can update case number, title, and charge", error, false);
    check("1b. Identity fields persisted", data?.case_number === `BIN-${stamp}-R` && data?.matter_title === "Retitled matter" && data?.charge_or_issue === "Assault");
  }

  {
    const { error } = await magClient
      .from("docket_matters")
      .update({ court_id: otherCourt.id })
      .eq("id", matter.id);
    checkErr("2. Court update is still rejected (docket_matters_guard)", error, true);
    const { data: still } = await admin.from("docket_matters").select("court_id").eq("id", matter.id).single();
    check("2b. court_id unchanged", still?.court_id === court.id);
  }

  {
    const { error } = await magClient.from("shares").insert({
      item_type: "docket_matter",
      item_id: matter.id,
      recipient_id: viewer.id,
      granted_by: magistrate.id,
      permission: "view",
    });
    checkErr("3. View share can be granted", error, false);
    const { error: binErr } = await viewerClient.rpc("bin_docket_matter", { p_id: matter.id });
    checkErr("3b. View-share recipient cannot bin", binErr, true);
  }

  {
    const { error } = await magClient.rpc("bin_docket_matter", { p_id: matter.id });
    checkErr("4. Editor can bin", error, false);
    const { data: listed } = await magClient.rpc("list_docket_matters", { p_court_id: court.id });
    check("4b. Binned matter is hidden from list_docket_matters", !(listed ?? []).some((r) => r.id === matter.id));
    const { data: row } = await magClient.from("docket_matters").select("deleted_at").eq("id", matter.id).single();
    check("4c. Direct read still sees the binned row", !!row?.deleted_at);
  }

  {
    const { error } = await magClient
      .from("docket_matters")
      .update({ matter_title: "Should not save" })
      .eq("id", matter.id);
    checkErr("5. Identity update is rejected while binned", error, true);
  }

  {
    const { error } = await magClient.rpc("restore_docket_matter", { p_id: matter.id });
    checkErr("6. Editor can restore", error, false);
    const { data: listed } = await magClient.rpc("list_docket_matters", { p_court_id: court.id });
    check("6b. Restored matter is back on list_docket_matters", (listed ?? []).some((r) => r.id === matter.id));
  }

  {
    const { error: binErr } = await magClient.rpc("bin_docket_matter", { p_id: matter.id });
    checkErr("7. Re-bin for purge tests", binErr, false);
    const { error: expErr } = await magClient.rpc("purge_expired_docket_matters");
    checkErr("7b. purge_expired_docket_matters runs", expErr, false);
    const { data: still } = await admin.from("docket_matters").select("id").eq("id", matter.id).maybeSingle();
    check("7c. Recently binned row is not purged before 7 days", !!still);
  }

  {
    const { error: livePurgeErr } = await magClient.rpc("purge_docket_matter", { p_id: matter.id });
    // still binned, so empty-now is allowed
    checkErr("8. Empty-now purge of a binned matter succeeds", livePurgeErr, false);
    const { data: gone } = await admin.from("docket_matters").select("id").eq("id", matter.id).maybeSingle();
    check("8b. Hard purge removed the row", !gone);
  }

  const { data: liveForSkip, error: liveCreateErr } = await magClient
    .from("docket_matters")
    .insert({ court_id: court.id, case_number: `BIN-LIVE-${stamp}`, matter_title: "Must stay in bin first" })
    .select()
    .single();
  if (liveCreateErr) throw liveCreateErr;
  {
    const { error } = await magClient.rpc("purge_docket_matter", { p_id: liveForSkip.id });
    checkErr("9. Live matter cannot skip the bin", error, true);
    const { data: still } = await admin.from("docket_matters").select("id").eq("id", liveForSkip.id).maybeSingle();
    check("9b. Live row still exists", !!still);
  }

  const { data: expiredMatter, error: expiredCreateErr } = await magClient
    .from("docket_matters")
    .insert({ court_id: court.id, case_number: `BIN-EXP-${stamp}`, matter_title: "Expired bin candidate" })
    .select()
    .single();
  if (expiredCreateErr) throw expiredCreateErr;
  {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const { error: stampErr } = await magClient
      .from("docket_matters")
      .update({ deleted_at: eightDaysAgo })
      .eq("id", expiredMatter.id);
    checkErr("10. Can move a live matter straight into an expired bin timestamp", stampErr, false);
    const { data: purged, error: purgeErr } = await magClient.rpc("purge_expired_docket_matters");
    checkErr("10b. purge_expired_docket_matters runs for expired row", purgeErr, false);
    check("10c. At least one expired matter was purged", (purged ?? 0) >= 1);
    const { data: gone } = await admin.from("docket_matters").select("id").eq("id", expiredMatter.id).maybeSingle();
    check("10d. Expired binned row is gone", !gone);
  }

  {
    const { data: logs, error } = await admin
      .from("audit_log")
      .select("action, old_data, new_data")
      .eq("table_name", "docket_matters")
      .eq("record_id", matter.id)
      .order("id", { ascending: true });
    checkErr("11. audit_log readable for the purged matter", error, false);
    const identityUpdate = (logs ?? []).some(
      (row) =>
        row.action === "update" &&
        row.old_data?.case_number === `BIN-${stamp}` &&
        row.new_data?.case_number === `BIN-${stamp}-R`,
    );
    const binUpdate = (logs ?? []).some(
      (row) => row.action === "update" && !row.old_data?.deleted_at && row.new_data?.deleted_at,
    );
    const purgeDelete = (logs ?? []).some(
      (row) => row.action === "delete" && row.old_data?.case_number === `BIN-${stamp}-R`,
    );
    check("11b. audit_log has identity update", identityUpdate);
    check("11c. audit_log has bin update", binUpdate);
    check("11d. audit_log has purge delete", purgeDelete);
  }

  console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll docket bin/purge tests passed.");
}

async function cleanup() {
  try {
    for (const courtId of created.courts) {
      const { data: leftover } = await admin.from("docket_matters").select("id").eq("court_id", courtId);
      const ids = leftover?.map((r) => r.id) ?? [];
      if (ids.length > 0) {
        await admin.from("docket_events").delete().in("docket_matter_id", ids);
        await admin.from("shares").delete().in("item_id", ids);
        await admin.from("docket_matters").delete().in("id", ids);
      }
      await admin.from("magistrate_courts").delete().eq("court_id", courtId);
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
