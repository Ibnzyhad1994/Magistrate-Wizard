/**
 * Live RPC checks for 0135/0136 against the running local database.
 * Creates a disposable magistrate, then tears them down.
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
// Creates and tears down a real magistrate account, so it must never be
// pointed at a live project by a stray VITE_SUPABASE_URL in the shell.
assertLocalSupabase(URL, "test:court-request-recovery-rpc");

const ADMIN_EMAIL = "admin@magistrate-wizard.local";
const PASSWORD = "password123";
const STAMP = Date.now().toString(36);
const TEST_EMAIL = `rpc-recovery-${STAMP}@magistrate-wizard.local`;

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    console.log("  expected:", expected);
    console.log("  actual:  ", actual);
    failures += 1;
  }
}

function expectError(label, error, needle) {
  const message = error?.message ?? String(error ?? "");
  const pass = needle.test(message);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    console.log("  expected message matching:", needle);
    console.log("  actual:", message);
    failures += 1;
  }
}

const asUser = (token) =>
  createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

let testUserId = null;

try {
  const { data: session, error: loginError } = await anon.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: PASSWORD,
  });
  if (loginError || !session.session) throw loginError ?? new Error("admin login failed");
  const adminClient = asUser(session.session.access_token);

  const { data: openapi, error: openapiError } = await adminClient.rpc(
    "return_unassigned_magistrate_to_requester",
    { p_profile_id: session.user.id, p_reason: "schema-cache probe" },
  );
  // Self-return is blocked once the function is in the schema cache.
  expectError(
    "PostgREST schema cache exposes return_unassigned_magistrate_to_requester",
    openapiError ?? new Error(`unexpected success: ${openapi}`),
    /cannot send your own|schema cache|Could not find the function/i,
  );
  if (openapiError && /schema cache|Could not find the function/i.test(openapiError.message)) {
    throw new Error(`RPC missing from schema cache: ${openapiError.message}`);
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `RPC Recovery ${STAMP}` },
  });
  if (createError) throw createError;
  testUserId = created.user.id;
  await new Promise((r) => setTimeout(r, 400));
  await admin.from("profiles").update({ role: "magistrate" }).eq("id", testUserId);

  const { data: court, error: courtError } = await admin.from("courts").select("id").limit(1).maybeSingle();
  if (courtError || !court?.id) throw courtError ?? new Error("no court to request");

  const { data: request, error: requestError } = await admin
    .from("magistrate_court_requests")
    .insert({ profile_id: testUserId, court_id: court.id, status: "pending" })
    .select("id, status")
    .single();
  if (requestError) throw requestError;

  const { error: emptyReasonError } = await adminClient.rpc("return_unassigned_magistrate_to_requester", {
    p_profile_id: testUserId,
    p_reason: "   ",
  });
  expectError("empty reason is rejected", emptyReasonError, /reason is required/i);

  const { data: rejectedCount, error: returnError } = await adminClient.rpc(
    "return_unassigned_magistrate_to_requester",
    { p_profile_id: testUserId, p_reason: "Wrong court — request again." },
  );
  check("return RPC succeeds for unassigned magistrate with a pending request", returnError, null);
  check("return RPC closes the pending request", rejectedCount, 1);

  const { data: afterReturn } = await admin
    .from("magistrate_court_requests")
    .select("status, rejection_reason")
    .eq("id", request.id)
    .single();
  check("pending request is now rejected", afterReturn?.status, "rejected");
  check("rejection reason is stored", afterReturn?.rejection_reason, "Wrong court — request again.");

  const { error: selfCorrectError } = await adminClient.rpc("correct_unassigned_account_type", {
    p_profile_id: session.user.id,
    p_new_role: "clerk",
    p_reason: "should not work on self",
  });
  expectError("cannot correct own account type", selfCorrectError, /cannot correct your own/i);

  const { error: toAdminError } = await adminClient.rpc("correct_unassigned_account_type", {
    p_profile_id: testUserId,
    p_new_role: "admin",
    p_reason: "should not promote",
  });
  expectError("cannot convert to admin", toAdminError, /magistrate and clerk/i);

  const { data: newRole, error: correctError } = await adminClient.rpc("correct_unassigned_account_type", {
    p_profile_id: testUserId,
    p_new_role: "clerk",
    p_reason: "Signed up as magistrate by mistake.",
  });
  check("account type correction to clerk succeeds", correctError, null);
  check("RPC returns clerk", newRole, "clerk");
  const { data: flipped } = await admin.from("profiles").select("role").eq("id", testUserId).single();
  check("profile.role is clerk", flipped?.role, "clerk");
} catch (error) {
  failures += 1;
  console.log("FAIL — uncaught", error instanceof Error ? error.message : error);
} finally {
  if (testUserId) {
    const { error } = await admin.auth.admin.deleteUser(testUserId);
    if (error) console.log("WARN — could not delete test user:", error.message);
  }
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
