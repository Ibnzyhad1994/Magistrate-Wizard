// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * BE-25 against the running local stack: Supabase Auth refuses a short or
 * simple password at signup, on an admin-created account and on a password
 * change, and accepts one that meets the policy in supabase/config.toml
 * (minimum 12; lower, upper, digit and symbol). The same passwords go
 * through the app's own form rules, so the client never accepts what the
 * server refuses. Creates disposable accounts and deletes them.
 *
 *   npm run test:auth-password-policy-live
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";
import { PASSWORD_RULES } from "../../src/lib/auth/password-policy.ts";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
assertLocalSupabase(URL, "test:auth-password-policy-live");

const STAMP = Date.now().toString(36);
const STRONG = "Policy-fixture-pass-123!";
const NEW_STRONG = "Policy-fixture-pass-456?";
// Each breaks exactly one part of the policy (the first, two).
const WEAK = {
  "six characters (the old minimum)": "Ab1!xy",
  "eleven characters, every class": "Abcdefg12#x",
  "no symbol": "GoodPass20261",
  "no uppercase": "good-pass-2026",
  "no lowercase": "GOOD-PASS-2026",
  "no digit": "Good-Pass-Word",
};

const admin = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anonClient = () =>
  createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

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

const clientAccepts = (password) => PASSWORD_RULES.every((rule) => rule.test(password));
/** GoTrue's refusal of a policy breach: HTTP 422, code weak_password. */
const isWeakPasswordError = (error) => error?.code === "weak_password" && error?.status === 422;

const created = [];

try {
  // --- signup ---------------------------------------------------------------
  for (const [index, [label, password]] of Object.entries(WEAK).entries()) {
    const email = `policy-weak-${STAMP}-${index}@magistrate-wizard.local`;
    const { data, error } = await anonClient().auth.signUp({ email, password });
    if (data?.user?.id) created.push(data.user.id);
    check(`signup refuses ${label} as weak_password`, isWeakPasswordError(error), true);
    check(`the form rules refuse ${label} too`, clientAccepts(password), false);
  }

  const signupEmail = `policy-ok-${STAMP}@magistrate-wizard.local`;
  const signup = await anonClient().auth.signUp({ email: signupEmail, password: STRONG });
  if (signup.data?.user?.id) created.push(signup.data.user.id);
  check("signup accepts a compliant password", signup.error?.message ?? null, null);
  check("the form rules accept it too", clientAccepts(STRONG), true);

  // --- admin-created account ------------------------------------------------
  const adminWeak = await admin.auth.admin.createUser({
    email: `policy-admin-weak-${STAMP}@magistrate-wizard.local`,
    password: "password123",
    email_confirm: true,
  });
  if (adminWeak.data?.user?.id) created.push(adminWeak.data.user.id);
  check(
    "an admin-created account with the seed-style password is refused",
    isWeakPasswordError(adminWeak.error),
    true,
  );

  // --- password change ------------------------------------------------------
  const email = `policy-change-${STAMP}@magistrate-wizard.local`;
  const fixture = await admin.auth.admin.createUser({
    email,
    password: STRONG,
    email_confirm: true,
  });
  if (fixture.error) throw fixture.error;
  created.push(fixture.data.user.id);

  const user = anonClient();
  const signIn = await user.auth.signInWithPassword({ email, password: STRONG });
  if (signIn.error) throw signIn.error;

  for (const [label, password] of Object.entries(WEAK)) {
    const { error } = await user.auth.updateUser({ password });
    check(`a password change to ${label} is refused`, isWeakPasswordError(error), true);
  }
  const change = await user.auth.updateUser({ password: NEW_STRONG });
  check(
    "a password change to a compliant password succeeds (fresh session, so secure_password_change asks no nonce)",
    change.error?.message ?? null,
    null,
  );
  const reSignIn = await anonClient().auth.signInWithPassword({ email, password: NEW_STRONG });
  check("the new password signs in", reSignIn.error?.message ?? null, null);
} catch (error) {
  console.log("FAIL - unexpected error:", error?.message ?? error);
  failures += 1;
} finally {
  for (const id of created) await admin.auth.admin.deleteUser(id);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
