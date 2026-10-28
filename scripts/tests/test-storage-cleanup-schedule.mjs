// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * The storage-cleanup queue drains on its own (0167), on a real database
 * with pg_cron, pg_net, Vault and the storage-cleanup Edge Function.
 *
 *   BE-07  a matter purged from the bin by the database's own job (no user
 *          delete follows it) loses its court documents from Storage within
 *          a couple of cron ticks, and its queue row is gone;
 *          a removal that keeps failing backs off, then is dead-lettered and
 *          no longer retried, so it cannot block the rest of the queue;
 *          no client role can ask for a scheduled run.
 *
 * Needs the scheduled-call configuration that live-db.yml writes after
 * `supabase start` (pg_net plus the project_url and service_role_key Vault
 * secrets); see supabase/README.md "Scheduled Edge Function calls".
 * Creates its own district, court, user, matter and file (all carrying the
 * fixture mark) and removes them afterwards, pass or fail.
 *
 *   npm run db:start && npm run test:storage-cleanup-schedule
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-storage-cleanup-schedule");
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// Two one-minute cron ticks plus the function's own run time.
const DRAIN_DEADLINE_MS = 150_000;

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

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(URL, SERVICE, noSession);
const MARK = `BE07-${Date.now() % 1_000_000}`;
const PASSWORD = "BE07-fixture-pass-123!";
const DEAD_BUCKET = `${MARK.toLowerCase()}-missing-bucket`;

const created = { users: [], courts: [], matters: [], objects: [], districtId: null };

const stored = async (path) => {
  const { data, error } = await admin.storage.from("documents").download(path);
  return !error && !!data;
};
const queueRow = async (bucket, path) =>
  must(
    await admin
      .from("storage_cleanup_queue")
      .select("attempts, next_attempt_at, dead_lettered_at, last_error")
      .eq("bucket_id", bucket)
      .eq("object_name", path)
      .maybeSingle(),
    "queue row",
  );
const runCleanup = async () => {
  const res = await fetch(`${URL}/functions/v1/storage-cleanup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
};

async function main() {
  // ---------- no client role can ask for a scheduled run ----------
  {
    const anon = createClient(URL, ANON, noSession);
    const { error } = await anon.rpc("request_storage_cleanup_run");
    check("BE-07 anon cannot call request_storage_cleanup_run", !!error, true);
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
  {
    const signedIn = createClient(URL, ANON, noSession);
    must(
      await signedIn.auth.signInWithPassword({ email: user.email, password: PASSWORD }),
      "sign in",
    );
    const { error } = await signedIn.rpc("request_storage_cleanup_run");
    check("BE-07 a signed-in user cannot call request_storage_cleanup_run", !!error, true);
  }

  // The scheduled call authenticates with the service-role key; prove the
  // function accepts it before waiting on the schedule.
  {
    const { status } = await runCleanup();
    check("BE-07 storage-cleanup accepts the service-role key", status, 200);
  }

  const district = must(
    await admin
      .from("magisterial_districts")
      .insert({ name: `${MARK} District` })
      .select("id")
      .single(),
    "district",
  );
  created.districtId = district.id;
  const court = must(
    await admin
      .from("courts")
      .insert({
        name: `${MARK} Court`,
        jurisdiction: "Test",
        district_id: district.id,
        is_active: true,
      })
      .select("id")
      .single(),
    "court",
  );
  created.courts.push(court.id);
  const matter = must(
    await admin
      .from("docket_matters")
      .insert({
        court_id: court.id,
        district_id: district.id,
        case_number: `${MARK}-PURGE`,
        matter_title: `${MARK} purged by the bin job`,
      })
      .select("id")
      .single(),
    "docket matter",
  );
  created.matters.push(matter.id);

  const path = `${user.id}/docket_matter/${matter.id}/${MARK}-exhibit.txt`;
  must(
    await admin.storage
      .from("documents")
      .upload(path, new Blob([`${MARK} sealed exhibit`], { type: "text/plain" }), {
        contentType: "text/plain",
      }),
    "upload exhibit",
  );
  created.objects.push(path);
  must(
    await admin.from("documents").insert({
      uploaded_by: user.id,
      file_name: `${MARK}-exhibit.txt`,
      file_path: path,
      file_size: 20,
      mime_type: "text/plain",
      entity_type: "docket_matter",
      entity_id: matter.id,
    }),
    "documents row",
  );

  // ---------- BE-07: the bin job's purge drains without any user delete ----------
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  must(
    await admin.from("docket_matters").update({ deleted_at: eightDaysAgo }).eq("id", matter.id),
    "bin the matter 8 days ago",
  );
  must(await admin.rpc("purge_expired_docket_matters"), "purge expired matters");
  check(
    "BE-07 the purge removed the matter",
    must(
      await admin.from("docket_matters").select("id").eq("id", matter.id).maybeSingle(),
      "matter after purge",
    ),
    null,
  );

  const started = Date.now();
  let drained = false;
  while (Date.now() - started < DRAIN_DEADLINE_MS) {
    if (!(await stored(path)) && (await queueRow("documents", path)) === null) {
      drained = true;
      break;
    }
    await sleep(2_000);
  }
  console.log(`  (waited ${Math.round((Date.now() - started) / 1000)}s for the schedule)`);
  check("BE-07 the purged matter's file leaves Storage on the schedule", drained, true);
  check("BE-07 its queue row is gone", await queueRow("documents", path), null);

  // ---------- a removal that keeps failing backs off, then is dead-lettered ----------
  const deadPath = `${MARK}/never-removable.txt`;
  must(
    await admin
      .from("storage_cleanup_queue")
      .insert({ bucket_id: DEAD_BUCKET, object_name: deadPath }),
    "queue a row in a bucket that does not exist",
  );
  {
    const { status } = await runCleanup();
    check("BE-07 a run with a failing row still answers 200", status, 200);
    const row = await queueRow(DEAD_BUCKET, deadPath);
    // >= 1, not 1: a scheduled run may take the same due row at the same moment.
    check("BE-07 the failing row counts its attempt", (row?.attempts ?? 0) >= 1, true);
    check(
      "BE-07 the failing row is pushed back, not retried at once",
      !!row && Date.parse(row.next_attempt_at) > Date.now(),
      true,
    );
    check("BE-07 one failure does not dead-letter it", row?.dead_lettered_at ?? null, null);
  }
  {
    must(
      await admin
        .from("storage_cleanup_queue")
        .update({ attempts: 7, next_attempt_at: new Date(Date.now() - 1_000).toISOString() })
        .eq("bucket_id", DEAD_BUCKET)
        .eq("object_name", deadPath),
      "make the row due on its last attempt",
    );
    await runCleanup();
    const row = await queueRow(DEAD_BUCKET, deadPath);
    check("BE-07 the eighth failure dead-letters the row", !!row?.dead_lettered_at, true);
    check("BE-07 the dead-lettered row keeps its last error", !!row?.last_error, true);
  }
  {
    must(
      await admin
        .from("storage_cleanup_queue")
        .update({ next_attempt_at: new Date(Date.now() - 1_000).toISOString() })
        .eq("bucket_id", DEAD_BUCKET)
        .eq("object_name", deadPath),
      "make the dead-lettered row due again",
    );
    await runCleanup();
    const row = await queueRow(DEAD_BUCKET, deadPath);
    check("BE-07 a dead-lettered row is not retried", row?.attempts, 8);
  }

  console.log(
    failures > 0 ? `\n${failures} failure(s).` : "\nAll storage-cleanup schedule tests passed.",
  );
}

async function cleanup() {
  try {
    await admin.from("storage_cleanup_queue").delete().eq("bucket_id", DEAD_BUCKET);
    if (created.objects.length > 0) {
      await admin.storage.from("documents").remove(created.objects);
      await admin.from("storage_cleanup_queue").delete().in("object_name", created.objects);
    }
    if (created.matters.length > 0) {
      await admin.from("documents").delete().in("entity_id", created.matters);
      await admin.from("docket_matters").delete().in("id", created.matters);
    }
    if (created.courts.length > 0) await admin.from("courts").delete().in("id", created.courts);
    if (created.districtId) {
      await admin.from("magisterial_districts").delete().eq("id", created.districtId);
    }
    for (const id of created.users) await admin.auth.admin.deleteUser(id);
  } catch (err) {
    console.error("Cleanup encountered an error:", err);
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
