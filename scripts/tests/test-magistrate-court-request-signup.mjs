// Live RLS/RPC test for magistrate court-request signup (0106) and admin
// visibility of unconfirmed requests (0115). Needs a running local
// Supabase instance and SUPABASE_SERVICE_ROLE_KEY.
//
// Run with:
//   SUPABASE_SERVICE_ROLE_KEY=... node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-magistrate-court-request-signup.mjs
//
// Creates throwaway district/court/auth users and deletes them at the end.

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  const candidates = [
    new URL("../../.env", import.meta.url),
    new URL("../../.env.local", import.meta.url),
  ];
  const env = {};
  for (const url of candidates) {
    if (!existsSync(url)) continue;
    const text = readFileSync(url, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2];
    }
  }
  return env;
}

const env = loadEnv();
const URL_ = env.VITE_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is required (see file header).");
  process.exit(1);
}
if (!URL_ || !ANON_KEY) {
  console.error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required in .env or .env.local.");
  process.exit(1);
}

const admin = createClient(URL_, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
  if (!condition) failures += 1;
}

const stamp = Date.now();
const email = (name) => `mcr-test-${name}-${stamp}@example.test`;

async function signAs(emailAddr, password) {
  const client = createClient(URL_, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: emailAddr, password });
  if (error) throw error;
  return client;
}

async function createUser(emailAddr, password, meta, { confirm } = { confirm: false }) {
  const { data, error } = await admin.auth.admin.createUser({
    email: emailAddr,
    password,
    email_confirm: confirm,
    user_metadata: meta,
  });
  if (error) throw error;
  return data.user;
}

const created = { users: [], courts: [], districtId: null };

async function main() {
  const { data: district, error: districtErr } = await admin
    .from("magisterial_districts")
    .insert({ name: `TEST MCR District ${stamp}` })
    .select()
    .single();
  if (districtErr) throw districtErr;
  created.districtId = district.id;

  const { data: court, error: courtErr } = await admin
    .from("courts")
    .insert({
      name: `TEST MCR Court ${stamp}`,
      jurisdiction: "Test",
      district_id: district.id,
      is_active: true,
    })
    .select()
    .single();
  if (courtErr) throw courtErr;
  created.courts.push(court.id);

  const password = "Test-Password-123!";

  const reviewer = await createUser(email("admin"), password, { full_name: "Test Reviewer Admin" }, { confirm: true });
  created.users.push(reviewer.id);
  const { error: roleErr } = await admin.from("profiles").update({ role: "admin" }).eq("id", reviewer.id);
  if (roleErr) throw roleErr;

  const bystander = await createUser(email("bystander"), password, { full_name: "Test Bystander Magistrate" }, { confirm: true });
  created.users.push(bystander.id);

  const applicant = await createUser(
    email("applicant"),
    password,
    {
      full_name: "Test Applicant Magistrate",
      requested_court_ids: [court.id],
    },
    { confirm: false },
  );
  created.users.push(applicant.id);

  {
    const { data } = await admin.from("profiles").select("role").eq("id", applicant.id).single();
    check("1. Signup without requested_role resolves to magistrate", data.role === "magistrate");
  }

  {
    const { data, error } = await admin
      .from("magistrate_court_requests")
      .select("id, court_id, status")
      .eq("profile_id", applicant.id);
    if (error) throw error;
    check(
      "2. Signup with requested_court_ids created one pending magistrate_court_requests row",
      data.length === 1 && data[0].court_id === court.id && data[0].status === "pending",
    );
  }

  const adminClient = await signAs(reviewer.email, password);
  {
    const { data, error } = await adminClient
      .from("magistrate_court_requests")
      .select("id, profile_id, status")
      .eq("profile_id", applicant.id);
    if (error) throw error;
    check(
      "3. Admin SELECT sees the unconfirmed magistrate's pending request (0115)",
      (data ?? []).length === 1 && data[0].status === "pending",
    );
  }

  {
    const { data: requestRow, error: requestErr } = await admin
      .from("magistrate_court_requests")
      .select("id")
      .eq("profile_id", applicant.id)
      .single();
    if (requestErr) throw requestErr;
    const { data, error } = await adminClient.rpc("list_magistrate_court_request_email_confirmation");
    if (error) throw error;
    const flagged = (data ?? []).find((r) => r.request_id === requestRow.id);
    check(
      "4. Confirmation helper reports email_confirmed=false for the unconfirmed applicant",
      Boolean(flagged) && flagged.email_confirmed === false,
    );
  }

  const bystanderClient = await signAs(bystander.email, password);
  {
    const { data, error } = await bystanderClient
      .from("magistrate_court_requests")
      .select("id")
      .eq("profile_id", applicant.id);
    if (error) throw error;
    check("5. Another magistrate cannot see the applicant's request", (data ?? []).length === 0);
  }

  const applicantSignIn = await (async () => {
    const client = createClient(URL_, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email: applicant.email, password });
    return { client, error };
  })();
  if (applicantSignIn.error) {
    check(
      "6. Unconfirmed applicant cannot sign in yet; pending request still exists for admin review",
      true,
    );
  } else {
    const { data, error } = await applicantSignIn.client.from("magistrate_court_requests").select("id, status");
    if (error) throw error;
    check(
      "6. Applicant can see their own pending request before email confirmation",
      (data ?? []).length === 1 && data[0].status === "pending",
    );
  }
}

async function cleanup() {
  try {
    for (const courtId of created.courts) {
      await admin.from("magistrate_court_requests").delete().eq("court_id", courtId);
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
