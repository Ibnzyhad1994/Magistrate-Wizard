// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * Anonymous auth events cannot flood the security log (0170), on a real
 * database.
 *
 *   BE-11  500 anonymous login_failed reports with 500 distinct emails write
 *          at most 120 rows a minute; the 10-a-minute limit per email still
 *          holds; a signed-in sign-in is still recorded after the flood.
 *
 * Creates its own user and rows (all carrying the fixture mark) and removes
 * them afterwards, pass or fail, along with the minute's anonymous budget so
 * later scripts start from zero.
 *
 *   npm run db:start && npm run test:auth-event-anon-cap
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-auth-event-anon-cap");
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const GLOBAL_CAP_PER_MINUTE = 120;
const PER_EMAIL_CAP_PER_MINUTE = 10;
const FLOOD = 500;
const CONCURRENCY = 20;

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const minuteOf = (ms) => Math.floor(ms / 60_000);

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(URL, SERVICE, noSession);
const anon = createClient(URL, ANON, noSession);
const MARK = `be11-${Date.now() % 1_000_000}`;
const PASSWORD = "BE11-fixture-pass-123!";
const created = { users: [] };

const report = (email) =>
  anon.rpc("record_auth_event", {
    p_event: "login_failed",
    p_email: email,
    p_user_agent: `${MARK} flood`,
  });
const rowsFor = async (pattern) => {
  const { count, error } = await admin
    .from("auth_event_log")
    .select("id", { count: "exact", head: true })
    .like("email", pattern);
  if (error) throw new Error(`count ${pattern}: ${error.message}`);
  return count ?? 0;
};

async function main() {
  // Start early in a minute, so the whole burst normally lands in one
  // window; the cap below still allows for a burst that spans two.
  while (new Date().getSeconds() > 40) await sleep(1_000);
  const started = Date.now();

  // ---------- the per-email limit still holds ----------
  const oneEmail = `${MARK}-same@example.test`;
  for (let i = 0; i < PER_EMAIL_CAP_PER_MINUTE + 2; i += 1) {
    must(await report(oneEmail), "report for one email");
  }
  check(
    "BE-11 one email still records at most 10 failed sign-ins a minute",
    await rowsFor(oneEmail),
    PER_EMAIL_CAP_PER_MINUTE,
  );

  // ---------- distinct emails share one global budget ----------
  let refused = 0;
  for (let next = 0; next < FLOOD; next += CONCURRENCY) {
    const batch = [];
    for (let i = next; i < Math.min(next + CONCURRENCY, FLOOD); i += 1) {
      batch.push(report(`${MARK}-${i}@example.test`));
    }
    for (const { error } of await Promise.all(batch)) if (error) refused += 1;
  }
  const windows = minuteOf(Date.now()) - minuteOf(started) + 1;
  const total = await rowsFor(`${MARK}-%`);
  console.log(`  (${total} rows from ${FLOOD + 12} reports across ${windows} minute window(s))`);
  check("BE-11 an over-budget report is dropped, not an error", refused, 0);
  check(
    `BE-11 ${FLOOD} distinct emails write at most ${GLOBAL_CAP_PER_MINUTE} rows a minute`,
    total <= GLOBAL_CAP_PER_MINUTE * windows,
    true,
  );
  check("BE-11 control: reports inside the budget are still recorded", total > 0, true);

  // ---------- signed-in events are not part of the anonymous budget ----------
  const user = must(
    await admin.auth.admin.createUser({
      email: `${MARK}-magistrate@example.test`,
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
  must(
    await signedIn.rpc("record_auth_event", {
      p_event: "login_success",
      p_email: user.email,
      p_user_agent: `${MARK} control`,
    }),
    "record login_success",
  );
  const { count: successes } = await admin
    .from("auth_event_log")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", user.id)
    .eq("event_type", "login_success");
  check("BE-11 control: a signed-in sign-in is still recorded after the flood", successes, 1);

  console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll auth-event cap tests passed.");
}

try {
  await main();
} catch (err) {
  console.error("Test run threw:", err);
  failures += 1;
} finally {
  await admin.from("auth_event_log").delete().like("email", `${MARK}-%`);
  await admin.from("rpc_rate_limit_buckets").delete().eq("rpc_name", "record_auth_event:anonymous");
  for (const id of created.users) await admin.auth.admin.deleteUser(id);
}
process.exit(failures > 0 ? 1 : 0);
