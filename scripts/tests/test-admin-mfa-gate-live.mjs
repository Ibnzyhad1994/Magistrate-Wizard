// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * BE-25 against the running local stack: TOTP enrolment and verification
 * work, and the administrator aal2 gate (0210) behaves as specified.
 *
 * 1. A disposable administrator enrols a TOTP factor and verifies it with a
 *    code computed from the enrolment secret (RFC 6238), which lifts the
 *    session from aal1 to aal2; a wrong code is refused.
 * 2. With require_admin_mfa off (its seeded state) both sessions are
 *    administrators, so nothing changes until the gate is switched on.
 * 3. In one rolled-back transaction, with the claims of those two real
 *    sessions: an aal1 session cannot switch the gate on, an aal2 session
 *    can; once on, the aal1 session loses administrator authority (is_admin,
 *    an admin-only RPC, an admin-only policy, and switching the gate off)
 *    while the aal2 session keeps it; a non-administrator at aal2 gains
 *    nothing; switched off again, aal1 is an administrator once more; the
 *    SQL editor (not a client session) can switch it either way. Nothing
 *    persists, so a gate left on can never leak into another test.
 *
 * Needs `psql`. Creates its own accounts and deletes them.
 *
 *   npm run test:admin-mfa-gate-live
 */
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";
import { runSql, sections } from "../test-support/psql.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
assertLocalSupabase(URL, "test:admin-mfa-gate-live");

const STAMP = Date.now().toString(36);
const PASSWORD = "Mfa-fixture-pass-123!";
const ADMIN_EMAIL = `mfa-admin-${STAMP}@magistrate-wizard.local`;
const MAGISTRATE_EMAIL = `mfa-magistrate-${STAMP}@magistrate-wizard.local`;

const admin = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

const claimsOf = (accessToken) =>
  JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error(`not base32: ${char}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP: SHA-1, 30-second steps, 6 digits (GoTrue's defaults). */
function totp(secret, now = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

async function createFixture(email, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `MFA ${role} ${STAMP}` },
  });
  if (error) throw error;
  const { error: roleError } = await admin.from("profiles").update({ role }).eq("id", data.user.id);
  if (roleError) throw roleError;
  return data.user.id;
}

const created = [];

try {
  const adminId = await createFixture(ADMIN_EMAIL, "admin");
  created.push(adminId);
  const magistrateId = await createFixture(MAGISTRATE_EMAIL, "magistrate");
  created.push(magistrateId);

  // --- TOTP enrol and verify ---------------------------------------------------
  const client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: PASSWORD });
  if (signIn.error) throw signIn.error;
  const aal1Token = signIn.data.session.access_token;
  check("a password sign-in is aal1", claimsOf(aal1Token).aal, "aal1");

  const enrolled = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Authenticator ${STAMP}`,
  });
  check("TOTP enrolment is enabled and succeeds", enrolled.error?.message ?? null, null);
  if (enrolled.error) throw enrolled.error;
  const factorId = enrolled.data.id;
  const secret = enrolled.data.totp.secret;
  check(
    "enrolment returns a secret and an otpauth URI",
    /^otpauth:\/\/totp\//.test(enrolled.data.totp.uri),
    true,
  );

  const wrongChallenge = await client.auth.mfa.challenge({ factorId });
  if (wrongChallenge.error) throw wrongChallenge.error;
  const goodCode = totp(secret);
  const wrongCode = goodCode === "000000" ? "111111" : "000000";
  const wrong = await client.auth.mfa.verify({
    factorId,
    challengeId: wrongChallenge.data.id,
    code: wrongCode,
  });
  check("a wrong code is refused", Boolean(wrong.error), true);

  const challenge = await client.auth.mfa.challenge({ factorId });
  if (challenge.error) throw challenge.error;
  const verified = await client.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: totp(secret),
  });
  check("the computed code verifies", verified.error?.message ?? null, null);
  if (verified.error) throw verified.error;
  const aal2Token = verified.data.access_token;
  const aal2Claims = claimsOf(aal2Token);
  check("the verified session is aal2", aal2Claims.aal, "aal2");
  check(
    "its amr records the TOTP step",
    (aal2Claims.amr ?? []).some((entry) => entry.method === "totp"),
    true,
  );

  const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: adminId });
  check(
    "the factor is verified on the account",
    factors?.factors?.find((f) => f.id === factorId)?.status,
    "verified",
  );

  // --- gate off: nothing changes ---------------------------------------------
  const asToken = (token) =>
    createClient(URL, ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const { data: flag } = await admin
    .from("feature_flags")
    .select("enabled")
    .eq("key", "require_admin_mfa")
    .single();
  check("require_admin_mfa is seeded off", flag?.enabled, false);
  check(
    "gate off: the aal1 administrator is an administrator",
    (await asToken(aal1Token).rpc("is_admin")).data,
    true,
  );
  check(
    "gate off: the aal2 administrator is an administrator",
    (await asToken(aal2Token).rpc("is_admin")).data,
    true,
  );

  // --- gate on and off, in one rolled-back transaction -------------------------
  const claims = (value) =>
    `do $d$ begin perform set_config('request.jwt.claims', $c$${JSON.stringify(value)}$c$, true); end $d$;`;
  const aal1 = claims(claimsOf(aal1Token));
  const aal2 = claims(aal2Claims);
  const magistrateAal2 = claims({ sub: magistrateId, role: "authenticated", aal: "aal2" });
  const asClient = (claimSql) => `reset role;\n${claimSql}\nset local role authenticated;`;

  const out = sections(
    runSql(
      `begin;
create function pg_temp.set_gate(p_on boolean) returns text language plpgsql as $$
declare n int;
begin
  update public.feature_flags set enabled = p_on where key = 'require_admin_mfa';
  get diagnostics n = row_count;
  return 'updated ' || n;
exception when others then return 'refused: ' || sqlerrm;
end $$;
create function pg_temp.try_admin_rpc() returns text language plpgsql as $$
begin
  perform public.admin_assign_magistrate_court(gen_random_uuid(), gen_random_uuid(), 'bogus');
  return 'no error';
exception when others then return sqlerrm;
end $$;
create function pg_temp.edit_flag_description() returns text language plpgsql as $$
declare n int;
begin
  update public.feature_flags set description = description where key = 'audit_export';
  get diagnostics n = row_count;
  return 'updated ' || n;
end $$;
grant execute on function pg_temp.set_gate(boolean), pg_temp.try_admin_rpc(),
  pg_temp.edit_flag_description() to authenticated;

${asClient(aal1)}
\\echo @@off_aal1_is_admin
select public.is_admin();
\\echo @@off_aal1_rpc
select pg_temp.try_admin_rpc();
\\echo @@aal1_turns_on
select pg_temp.set_gate(true);

${asClient(aal2)}
\\echo @@aal2_turns_on
select pg_temp.set_gate(true);
\\echo @@on_aal2_is_admin
select public.is_admin();
\\echo @@on_aal2_rpc
select pg_temp.try_admin_rpc();
\\echo @@on_aal2_policy
select pg_temp.edit_flag_description();

${asClient(aal1)}
\\echo @@on_aal1_is_admin
select public.is_admin();
\\echo @@on_aal1_rpc
select pg_temp.try_admin_rpc();
\\echo @@on_aal1_policy
select pg_temp.edit_flag_description();
\\echo @@on_aal1_turns_off
select pg_temp.set_gate(false);
\\echo @@on_aal1_still_reads_flag
select enabled from public.feature_flags where key = 'require_admin_mfa';

${asClient(magistrateAal2)}
\\echo @@on_magistrate_aal2_is_admin
select public.is_admin();

${asClient(aal2)}
\\echo @@aal2_turns_off
select pg_temp.set_gate(false);

${asClient(aal1)}
\\echo @@off_again_aal1_is_admin
select public.is_admin();

reset role;
do $d$ begin perform set_config('request.jwt.claims', '', true); end $d$;
\\echo @@sql_editor_turns_on
select pg_temp.set_gate(true);
\\echo @@sql_editor_turns_off
select pg_temp.set_gate(false);
rollback;
`,
      "test:admin-mfa-gate-live",
    ),
  );

  const NOT_ADMIN = "Only a Court Assignment Administrator may create a court assignment";
  const PASSED_GATE = "Invalid assignment type: bogus";
  check("gate off: aal1 is an administrator", out.off_aal1_is_admin, "t");
  check("gate off: aal1 passes an admin-only RPC's check", out.off_aal1_rpc, PASSED_GATE);
  check(
    "an aal1 session cannot switch the gate on",
    out.aal1_turns_on,
    "refused: Verify a second factor before requiring one for administrators",
  );
  check("an aal2 administrator can switch it on", out.aal2_turns_on, "updated 1");
  check("gate on: aal2 is an administrator", out.on_aal2_is_admin, "t");
  check("gate on: aal2 passes the admin-only RPC", out.on_aal2_rpc, PASSED_GATE);
  check("gate on: aal2 passes an admin-only policy", out.on_aal2_policy, "updated 1");
  check("gate on: aal1 is not an administrator", out.on_aal1_is_admin, "f");
  check("gate on: aal1 is refused by the admin-only RPC", out.on_aal1_rpc, NOT_ADMIN);
  check("gate on: aal1 is refused by the admin-only policy", out.on_aal1_policy, "updated 0");
  check("gate on: aal1 cannot switch the gate off", out.on_aal1_turns_off, "updated 0");
  check("gate on: the flag stays on", out.on_aal1_still_reads_flag, "t");
  check("gate on: a non-administrator at aal2 gains nothing", out.on_magistrate_aal2_is_admin, "f");
  check("an aal2 administrator can switch it off", out.aal2_turns_off, "updated 1");
  check("gate off again: aal1 is an administrator once more", out.off_again_aal1_is_admin, "t");
  check("the SQL editor can switch it on (recovery path)", out.sql_editor_turns_on, "updated 1");
  check("the SQL editor can switch it off", out.sql_editor_turns_off, "updated 1");

  const { data: after } = await admin
    .from("feature_flags")
    .select("enabled")
    .eq("key", "require_admin_mfa")
    .single();
  check("nothing persisted: the gate is still off", after?.enabled, false);
} catch (error) {
  console.log("FAIL - unexpected error:", error?.message ?? error);
  failures += 1;
} finally {
  for (const id of created) await admin.auth.admin.deleteUser(id);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
