// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * anon runs only the SECURITY DEFINER functions it needs (0169), on a real
 * database.
 *
 *   BE-12  the signed-in-only RPCs that a bare `revoke ... from public` left
 *          open to anon refuse it, while a signed-in user still calls them;
 *          the set anon can still execute is exactly the reviewed
 *          allowlist below (RLS helpers that policies applying to PUBLIC
 *          evaluate, the sign-up lookups, record_auth_event), so a new
 *          migration cannot widen it unnoticed;
 *          the sign-up lookups still answer anon.
 *
 * A new function that anon really needs goes on ANON_ALLOWLIST with its
 * reason in the migration that grants it.
 *
 *   npm run db:start && npm run test:anon-definer-surface
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-anon-definer-surface");
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

/** SECURITY DEFINER functions anon may execute, and why (0169's header). */
const ANON_ALLOWLIST = new Set([
  // RLS helpers evaluated by policies that apply to PUBLIC.
  "can_access_callover",
  "can_attach_preview_derivative",
  "can_edit_case_law",
  "can_edit_docket_matter",
  "can_edit_judgment",
  "can_view_case_law",
  "can_view_docket_matter",
  "can_view_judgment",
  "can_view_statute",
  "clerk_access_request_email_confirmed",
  "has_active_magistrate_court",
  "has_docket_matter_authority",
  "has_item_share",
  "has_item_share_authority",
  "is_admin",
  "is_clerk",
  "is_magistrate",
  "magistrate_court_request_email_confirmed",
  "my_court_id",
  "user_can_access_bench_note",
  "user_can_access_case",
  // The sign-up surface.
  "court_has_active_primary_magistrate",
  "list_active_courts_for_magistrate_signup",
  "list_active_courts_for_signup",
  "list_active_magisterial_districts_for_signup",
  // Failed sign-ins and reset requests are reported before a session exists.
  "record_auth_event",
]);

/** Revoked from anon by 0169; every one is called only signed in. */
const SIGNED_IN_ONLY = [
  "apply_case_law_tags",
  "apply_statute_tags",
  "finalize_legislation_document",
  "publish_case_law_import",
  "reject_case_law_import",
  "publish_legislation_import",
  "reject_legislation_import",
  "set_case_law_review_status",
  "set_legislation_review_status",
  "set_docket_matter_next_date",
  "relinquish_magistrate_court",
  "list_courts_for_magistrate_request",
  "clerk_profiles_for_review",
  "list_clerk_access_requests_needing_admin_attention",
  "list_magistrate_court_request_email_confirmation",
  "is_sole_admin_bootstrap_available",
];

/** The zero-argument ones, called for real as anon and signed in. */
const PROBES = [
  "list_courts_for_magistrate_request",
  "list_clerk_access_requests_needing_admin_attention",
  "list_magistrate_court_request_email_confirmation",
  "is_sole_admin_bootstrap_available",
];

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

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(URL, SERVICE, noSession);
const anon = createClient(URL, ANON, noSession);
const MARK = `BE12-${Date.now() % 1_000_000}`;
const PASSWORD = "BE12-fixture-pass-123!";
const created = { users: [] };

async function main() {
  // ---------- the catalogue: anon's definer surface is the allowlist ----------
  const signatures = must(
    await admin.rpc("anon_executable_definer_functions"),
    "anon_executable_definer_functions",
  );
  const names = [...new Set(signatures.map((sig) => sig.replace(/\(.*$/, "")))].sort();
  const unexpected = names.filter((name) => !ANON_ALLOWLIST.has(name));
  check("BE-12 anon executes no SECURITY DEFINER function outside the allowlist", unexpected, []);
  check(
    "BE-12 none of the signed-in-only RPCs is anon-executable",
    SIGNED_IN_ONLY.filter((name) => names.includes(name)),
    [],
  );
  check(
    "BE-12 control: the allowlisted helpers are still anon-executable",
    [...ANON_ALLOWLIST].filter((name) => !names.includes(name)),
    [],
  );
  {
    const { error } = await anon.rpc("anon_executable_definer_functions");
    check("BE-12 anon cannot read the catalogue itself", !!error, true);
  }

  // ---------- real calls ----------
  for (const fn of PROBES) {
    const { error } = await anon.rpc(fn);
    check(`BE-12 anon is refused ${fn}`, error?.code ?? null, "42501");
  }

  const user = must(
    await admin.auth.admin.createUser({
      email: `${MARK.toLowerCase()}-magistrate@example.test`,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `${MARK} Magistrate` },
    }),
    "fixture user",
  ).user;
  created.users.push(user.id);
  const signedIn = createClient(URL, ANON, noSession);
  must(
    await signedIn.auth.signInWithPassword({ email: user.email, password: PASSWORD }),
    "sign in",
  );
  for (const fn of PROBES) {
    const { error } = await signedIn.rpc(fn);
    check(`BE-12 control: a signed-in user still calls ${fn}`, error?.message ?? null, null);
  }

  for (const fn of [
    "list_active_courts_for_signup",
    "list_active_magisterial_districts_for_signup",
    "list_active_courts_for_magistrate_signup",
  ]) {
    const { error } = await anon.rpc(fn);
    check(`BE-12 control: sign-up still calls ${fn} as anon`, error?.message ?? null, null);
  }

  console.log(
    failures > 0 ? `\n${failures} failure(s).` : "\nAll anon definer surface tests passed.",
  );
}

try {
  await main();
} catch (err) {
  console.error("Test run threw:", err);
  failures += 1;
} finally {
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
}
process.exit(failures > 0 ? 1 : 0);
