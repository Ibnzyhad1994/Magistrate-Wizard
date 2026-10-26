// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * The Docket bin keeps its promises (0161), on a real database.
 *
 * Replays the 2026-10-15 audit's theme T1 repros through the same clients
 * the app and an attacker would use:
 *
 *   B-01  an edit-share recipient at another court, or a clerk, can neither
 *         bin nor empty a court's matter; emptying it keeps every author's
 *         bench notes; the court's other staff are told about both steps;
 *   B-02  no client (clerk, magistrate or anon) can write deleted_at or
 *         deleted_by, or create a matter already in the bin; opening the
 *         Bin page purges nothing; anon and signed-in users cannot run the
 *         expiry purge, which only the scheduler (here the service role,
 *         standing in for pg_cron) runs;
 *   B-04  a restore racing an "Empty now" never reports success and then
 *         loses the matter;
 *   B-10  a binned matter takes no next date, hearing or hearing edit, and
 *         the daily past-hearings job still runs past it.
 *
 * Controls show the legitimate path still works: a court magistrate bins,
 * restores and empties; any editor (clerk, edit share) restores; the edit
 * share still edits the live file; scheduling works again after restore.
 *
 * Creates its own district, courts, users and rows (all carrying the fixture
 * mark) and removes every one of them afterwards, pass or fail.
 *
 *   npm run db:start && npm run test:docket-bin-integrity
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-docket-bin-integrity");
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const RACE_TRIALS = Number(process.env.RACE_TRIALS ?? 20);

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
const refused = ({ error }) => (error ? "refused" : "allowed");
const execDenied = ({ error }) =>
  error?.code === "42501" ? "no EXECUTE" : `got ${error?.code ?? "success"}`;

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(URL, SERVICE, noSession);
const anon = createClient(URL, ANON, noSession);
const MARK = `T1-FIX-${Date.now() % 1_000_000}`;
const PASSWORD = "T1-fixture-pass-123!";
const email = (name) => `${MARK.toLowerCase()}-${name}@example.test`;

const created = { users: [], courts: [], districtId: null };

async function createUser(name, role) {
  const user = must(
    await admin.auth.admin.createUser({
      email: email(name),
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `${MARK} ${name}` },
    }),
    `create ${name}`,
  ).user;
  created.users.push(user.id);
  if (role !== "magistrate") {
    must(await admin.from("profiles").update({ role }).eq("id", user.id), `role ${name}`);
  }
  return user;
}

async function signIn(user) {
  const client = createClient(URL, ANON, noSession);
  must(await client.auth.signInWithPassword({ email: user.email, password: PASSWORD }), "sign in");
  return client;
}

/** The next weekday at least `days` ahead, as YYYY-MM-DD. */
function weekdayAhead(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function matterRow(id) {
  return must(
    await admin
      .from("docket_matters")
      .select("id, deleted_at, deleted_by")
      .eq("id", id)
      .maybeSingle(),
    "read matter",
  );
}

async function eventCount(id) {
  const rows = must(
    await admin.from("docket_events").select("id").eq("docket_matter_id", id),
    "read events",
  );
  return rows.length;
}

async function noticesFor(id) {
  const rows = must(
    await admin.from("notifications").select("user_id, type").eq("link", `/docket/${id}`),
    "read notifications",
  );
  return rows;
}

async function main() {
  // ---------- fixtures ----------
  const district = must(
    await admin
      .from("magisterial_districts")
      .insert({ name: `${MARK} District` })
      .select()
      .single(),
    "district",
  );
  created.districtId = district.id;
  const court = async (suffix) => {
    const row = must(
      await admin
        .from("courts")
        .insert({
          name: `${MARK} ${suffix}`,
          jurisdiction: "Test",
          district_id: district.id,
          is_active: true,
        })
        .select()
        .single(),
      `court ${suffix}`,
    );
    created.courts.push(row.id);
    return row.id;
  };
  const courtA = await court("Court A");
  const courtB = await court("Court B");

  const m1 = await createUser("m1", "magistrate");
  const m2 = await createUser("m2", "magistrate");
  const m3 = await createUser("m3", "magistrate");
  const c1 = await createUser("c1", "clerk");
  must(
    await admin.from("magistrate_courts").insert([
      { profile_id: m1.id, court_id: courtA },
      { profile_id: m2.id, court_id: courtA },
      { profile_id: m3.id, court_id: courtB },
    ]),
    "seat magistrates",
  );
  must(
    await admin
      .from("clerk_courts")
      .insert({ profile_id: c1.id, court_id: courtA, approved_by: m1.id }),
    "attach clerk",
  );

  const M1 = await signIn(m1);
  const M2 = await signIn(m2);
  const M3 = await signIn(m3);
  const C1 = await signIn(c1);

  let seq = 0;
  const newMatter = async (client = M1) =>
    must(
      await client
        .from("docket_matters")
        .insert({
          court_id: courtA,
          case_number: `${MARK}-${(seq += 1)}`,
          matter_title: `Police v. ${MARK} accused ${seq}`,
          charge_or_issue: "Larceny",
        })
        .select()
        .single(),
      "create matter",
    );
  const setNextDate = (client, id, days) =>
    client.rpc("set_docket_matter_next_date", {
      p_docket_matter_id: id,
      p_scheduled_date: weekdayAhead(days),
    });

  // ---------- B-01: only court authority bins or empties; bench notes survive ----------
  {
    const matter = await newMatter();
    must(await setNextDate(M1, matter.id, 14), "next date");
    const m1Note = must(
      await M1.from("bench_notes")
        .insert({
          title: `${MARK} M1 private note`,
          content_text: "my private view of the witness",
          entity_type: "docket_matter",
          entity_id: matter.id,
          author_id: m1.id,
        })
        .select("id")
        .single(),
      "M1 bench note",
    );
    const m2Note = must(
      await M2.from("bench_notes")
        .insert({
          title: `${MARK} M2 private note`,
          content_text: "M2's own view",
          entity_type: "docket_matter",
          entity_id: matter.id,
          author_id: m2.id,
        })
        .select("id")
        .single(),
      "M2 bench note",
    );
    must(
      await M1.from("shares").insert({
        item_type: "docket_matter",
        item_id: matter.id,
        recipient_id: m3.id,
        granted_by: m1.id,
        permission: "edit",
      }),
      "edit share to M3",
    );

    check(
      "B-01 control: the edit-share recipient still edits the live file",
      refused(
        await M3.from("docket_matters")
          .update({ charge_or_issue: "Larceny (amended by M3)" })
          .eq("id", matter.id)
          .select("id")
          .single(),
      ),
      "allowed",
    );
    check(
      "B-01: the edit-share recipient at another court cannot move the matter to the bin",
      refused(await M3.rpc("bin_docket_matter", { p_id: matter.id })),
      "refused",
    );
    check(
      "B-01: a clerk cannot move the matter to the bin",
      refused(await C1.rpc("bin_docket_matter", { p_id: matter.id })),
      "refused",
    );
    check("B-01: the matter is still live", (await matterRow(matter.id))?.deleted_at, null);

    check(
      "B-01 control: a court magistrate moves the matter to the bin",
      refused(await M1.rpc("bin_docket_matter", { p_id: matter.id })),
      "allowed",
    );
    check(
      "B-01: the court's other staff are told it was binned, the binner is not",
      (await noticesFor(matter.id))
        .filter((n) => n.type === "docket_matter_binned")
        .map((n) => n.user_id)
        .sort(),
      [m2.id, c1.id].sort(),
    );

    check(
      "B-01: the edit-share recipient cannot empty it",
      refused(await M3.rpc("purge_docket_matter", { p_id: matter.id })),
      "refused",
    );
    check(
      "B-01: a clerk cannot empty it",
      refused(await C1.rpc("purge_docket_matter", { p_id: matter.id })),
      "refused",
    );
    check("B-01: the matter survives both attempts", !!(await matterRow(matter.id)), true);

    const binFor = async (client) =>
      (must(await client.rpc("list_binned_docket_matters"), "bin list") ?? [])
        .filter((r) => r.id === matter.id)
        .map((r) => r.can_purge);
    check("B-01: the Bin page offers M3 no Empty now", await binFor(M3), [false]);
    check("B-01: the Bin page offers the clerk no Empty now", await binFor(C1), [false]);
    check("B-01: the Bin page offers the court magistrate Empty now", await binFor(M1), [true]);

    check(
      "B-01 control: the clerk can still restore it",
      refused(await C1.rpc("restore_docket_matter", { p_id: matter.id })),
      "allowed",
    );
    must(await M1.rpc("bin_docket_matter", { p_id: matter.id }), "re-bin");
    check(
      "B-01 control: the edit-share recipient can still restore it",
      refused(await M3.rpc("restore_docket_matter", { p_id: matter.id })),
      "allowed",
    );
    must(await M1.rpc("bin_docket_matter", { p_id: matter.id }), "re-bin");

    check(
      "B-01 control: a court magistrate empties it",
      refused(await M1.rpc("purge_docket_matter", { p_id: matter.id })),
      "allowed",
    );
    check("B-01: the matter is gone", await matterRow(matter.id), null);
    check("B-01: its hearings are gone", await eventCount(matter.id), 0);
    check(
      "B-01: every author's bench note on it survives",
      must(await admin.from("bench_notes").select("id").in("id", [m1Note.id, m2Note.id]), "notes")
        .length,
      2,
    );
    check(
      "B-01: M1 still reads and edits their own note",
      refused(
        await M1.from("bench_notes")
          .update({ content_text: "still mine" })
          .eq("id", m1Note.id)
          .select("id")
          .single(),
      ),
      "allowed",
    );
    check(
      "B-01: M1 still cannot read M2's note (ADR 0004)",
      must(await M1.from("bench_notes").select("id").eq("id", m2Note.id), "read M2 note").length,
      0,
    );
    check(
      "B-01: the court's other staff are told it was permanently deleted",
      (await noticesFor(matter.id))
        .filter((n) => n.type === "docket_matter_purged")
        .map((n) => n.user_id)
        .sort(),
      [m2.id, c1.id].sort(),
    );
  }

  // ---------- B-02: the bin columns are server-stamped, and only the scheduler purges ----------
  {
    const matter = await newMatter();
    must(await setNextDate(M1, matter.id, 20), "next date");
    check(
      "B-02: a clerk cannot write deleted_at / deleted_by directly",
      refused(
        await C1.from("docket_matters")
          .update({ deleted_at: "2020-01-01T00:00:00Z", deleted_by: m1.id })
          .eq("id", matter.id)
          .select("id"),
      ),
      "refused",
    );
    check(
      "B-02: a magistrate cannot write deleted_at directly either",
      refused(
        await M1.from("docket_matters")
          .update({ deleted_at: "2020-01-01T00:00:00Z" })
          .eq("id", matter.id)
          .select("id"),
      ),
      "refused",
    );
    check(
      "B-02: nor deleted_by alone",
      refused(
        await M1.from("docket_matters")
          .update({ deleted_by: m2.id })
          .eq("id", matter.id)
          .select("id"),
      ),
      "refused",
    );
    check("B-02: the matter is still live and unattributed", await matterRow(matter.id), {
      id: matter.id,
      deleted_at: null,
      deleted_by: null,
    });
    check(
      "B-02: a matter cannot be created already in the bin",
      refused(
        await M1.from("docket_matters")
          .insert({
            court_id: courtA,
            case_number: `${MARK}-born-binned`,
            matter_title: "Born binned",
            deleted_at: "2020-01-01T00:00:00Z",
            deleted_by: m2.id,
          })
          .select("id"),
      ),
      "refused",
    );

    const before = Date.now();
    must(await M1.rpc("bin_docket_matter", { p_id: matter.id }), "bin");
    const binned = await matterRow(matter.id);
    check("B-02 control: binning stamps the binner", binned?.deleted_by, m1.id);
    check(
      "B-02 control: binning stamps the server time",
      Math.abs(new Date(binned?.deleted_at).getTime() - before) < 60_000,
      true,
    );
    check(
      "B-02: a binned matter cannot be back-dated directly",
      refused(
        await M1.from("docket_matters")
          .update({ deleted_at: "2020-01-01T00:00:00Z" })
          .eq("id", matter.id)
          .select("id"),
      ),
      "refused",
    );
    check(
      "B-02: a binned matter cannot be restored by a direct write",
      refused(
        await C1.from("docket_matters")
          .update({ deleted_at: null, deleted_by: null })
          .eq("id", matter.id)
          .select("id"),
      ),
      "refused",
    );

    // A second matter that has sat in the bin for 8 days. The service role
    // bins it in the past in one step, as the scheduler's clock would see it.
    const expired = await newMatter();
    must(await setNextDate(M1, expired.id, 20), "next date");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    must(
      await admin
        .from("docket_matters")
        .update({ deleted_at: eightDaysAgo, deleted_by: m1.id })
        .eq("id", expired.id),
      "bin 8 days ago",
    );

    must(await M3.rpc("list_binned_docket_matters"), "M3 opens their Bin page");
    must(await M1.rpc("list_binned_docket_matters"), "M1 opens their Bin page");
    check("B-02: opening Bin pages purges nothing", !!(await matterRow(expired.id)), true);

    check(
      "B-02: anon cannot run the expiry purge",
      execDenied(await anon.rpc("purge_expired_docket_matters")),
      "no EXECUTE",
    );
    check(
      "B-02: a signed-in magistrate cannot run the expiry purge",
      execDenied(await M1.rpc("purge_expired_docket_matters")),
      "no EXECUTE",
    );
    for (const fn of ["bin_docket_matter", "restore_docket_matter", "purge_docket_matter"]) {
      check(
        `B-02: anon cannot execute ${fn}`,
        execDenied(await anon.rpc(fn, { p_id: matter.id })),
        "no EXECUTE",
      );
    }
    check(
      "B-02: anon cannot execute list_binned_docket_matters",
      execDenied(await anon.rpc("list_binned_docket_matters")),
      "no EXECUTE",
    );
    check("B-02: the expired matter is still there", !!(await matterRow(expired.id)), true);

    const purged = must(await admin.rpc("purge_expired_docket_matters"), "scheduler purge");
    check("B-02 control: the scheduler's expiry purge removes expired matters", purged >= 1, true);
    check("B-02 control: the expired matter is gone", await matterRow(expired.id), null);
    check("B-02 control: its hearings are gone", await eventCount(expired.id), 0);
    check("B-02 control: a matter binned today is kept", !!(await matterRow(matter.id)), true);
    check(
      "B-02 control: court staff, the binner included, are told of the expiry purge",
      (await noticesFor(expired.id))
        .filter((n) => n.type === "docket_matter_purged")
        .map((n) => n.user_id)
        .sort(),
      [m1.id, m2.id, c1.id].sort(),
    );
  }

  // ---------- B-04: restore racing Empty now ----------
  {
    const tally = {};
    let lost = 0;
    let inconsistent = 0;
    for (let i = 0; i < RACE_TRIALS; i += 1) {
      const matter = await newMatter();
      must(await M1.rpc("bin_docket_matter", { p_id: matter.id }), "bin for race");
      const [restore, purge] = await Promise.all([
        M2.rpc("restore_docket_matter", { p_id: matter.id }),
        M1.rpc("purge_docket_matter", { p_id: matter.id }),
      ]);
      const row = await matterRow(matter.id);
      const final = row ? (row.deleted_at ? "binned" : "live") : "gone";
      const restored = !restore.error && restore.data?.deleted_at === null;
      const key = `restore=${restored ? "restored" : restore.error ? "error" : "other"} purge=${purge.error ? "error" : "purged"} final=${final}`;
      tally[key] = (tally[key] ?? 0) + 1;
      if (restored && final === "gone") lost += 1;
      const consistent =
        (restored && !!purge.error && final === "live") ||
        (!!restore.error && !purge.error && final === "gone");
      if (!consistent) inconsistent += 1;
    }
    console.log("  race outcomes:", JSON.stringify(tally));
    check(
      `B-04: no restore reports success and then loses the matter (${RACE_TRIALS} races)`,
      lost,
      0,
    );
    check("B-04: every race has exactly one winner and a matching final state", inconsistent, 0);
  }

  // ---------- B-10: a binned matter is frozen for scheduling ----------
  {
    const matter = await newMatter();
    must(await setNextDate(M1, matter.id, 9), "next date");
    const pastEvent = must(
      await M1.from("docket_events")
        .insert({
          docket_matter_id: matter.id,
          scheduled_date: "2020-01-06",
          event_status: "scheduled",
        })
        .select("id")
        .single(),
      "past-dated hearing",
    );
    const [liveEvent] = must(
      await admin
        .from("docket_events")
        .select("id")
        .eq("docket_matter_id", matter.id)
        .neq("id", pastEvent.id),
      "next-date event",
    );
    must(await M1.rpc("bin_docket_matter", { p_id: matter.id }), "bin");
    const eventsWhenBinned = await eventCount(matter.id);

    check(
      "B-10: another magistrate cannot set a next date on a binned matter",
      refused(await setNextDate(M2, matter.id, 23)),
      "refused",
    );
    check(
      "B-10: a clerk cannot schedule a hearing on a binned matter",
      refused(
        await C1.rpc("schedule_docket_event_with_capacity", {
          p_docket_matter_id: matter.id,
          p_scheduled_date: weekdayAhead(24),
          p_event_status: "scheduled",
          p_event_type: "Mention",
        }),
      ),
      "refused",
    );
    check(
      "B-10: a clerk cannot insert a hearing on a binned matter directly",
      refused(
        await C1.from("docket_events")
          .insert({
            docket_matter_id: matter.id,
            scheduled_date: weekdayAhead(25),
            event_status: "scheduled",
          })
          .select("id"),
      ),
      "refused",
    );
    check(
      "B-10: the magistrate cannot edit a hearing on a binned matter",
      refused(
        await M1.from("docket_events")
          .update({ notes: "edited while binned" })
          .eq("id", liveEvent.id)
          .select("id"),
      ),
      "refused",
    );
    check("B-10: no hearing was added", await eventCount(matter.id), eventsWhenBinned);

    must(
      await admin.rpc("mark_past_hearings"),
      "daily past-hearings job runs with a binned matter",
    );
    const pastWhileBinned = must(
      await admin.from("docket_events").select("event_status").eq("id", pastEvent.id).single(),
      "read past event",
    );
    check(
      "B-10: the daily job leaves the binned matter's hearings alone",
      pastWhileBinned.event_status,
      "scheduled",
    );

    must(await M1.rpc("restore_docket_matter", { p_id: matter.id }), "restore");
    check(
      "B-10 control: after restore a next date can be set again",
      refused(await setNextDate(M2, matter.id, 23)),
      "allowed",
    );
    must(await admin.rpc("mark_past_hearings"), "daily job after restore");
    const pastAfterRestore = must(
      await admin.from("docket_events").select("event_status").eq("id", pastEvent.id).single(),
      "read past event",
    );
    check(
      "B-10 control: after restore the daily job marks it past",
      pastAfterRestore.event_status,
      "past",
    );
  }

  console.log(
    failures > 0 ? `\n${failures} failure(s).` : "\nAll docket bin integrity tests passed.",
  );
}

async function cleanup() {
  try {
    if (created.users.length > 0) {
      await admin.from("bench_notes").delete().in("author_id", created.users);
      await admin.from("notifications").delete().in("user_id", created.users);
    }
    for (const courtId of created.courts) {
      const { data: leftover } = await admin
        .from("docket_matters")
        .select("id")
        .eq("court_id", courtId);
      const ids = leftover?.map((r) => r.id) ?? [];
      if (ids.length > 0) {
        await admin.from("docket_events").delete().in("docket_matter_id", ids);
        await admin.from("shares").delete().in("item_id", ids);
        await admin.from("docket_matters").delete().in("id", ids);
      }
      await admin.from("clerk_courts").delete().eq("court_id", courtId);
      await admin.from("magistrate_courts").delete().eq("court_id", courtId);
      await admin.from("courts").delete().eq("id", courtId);
    }
    if (created.districtId)
      await admin.from("magisterial_districts").delete().eq("id", created.districtId);
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
