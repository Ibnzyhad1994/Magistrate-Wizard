// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * A callover stays the record of its sitting (0164), on a real database.
 *
 * Replays the 2026-10-15 audit's theme T3 repros through the same clients
 * the app and an attacker would use:
 *
 *   B-08  once a callover is completed, no app user (a colleague at the
 *         court, or an administrator) can rewrite an outcome, clear a call,
 *         remove a row, add a row, set it back to draft or reopen it, or
 *         delete it; an in-progress callover cannot go back to draft; a
 *         recorded call is never cleared, even on a draft; a callover with
 *         a called matter cannot be deleted;
 *   B-09  a callover item cannot be re-pointed at another matter (another
 *         court's, or the caller's own), moved to another callover, and a
 *         callover cannot be moved to another court.
 *
 * Controls show the legitimate path still works: creating and filling a
 * draft, adding and removing uncalled rows, calling and editing rows on a
 * draft and an in-progress callover, deleting a draft nobody was called on,
 * completing a callover from draft or from in progress, and permanently
 * deleting a binned matter that sits on a completed callover (its row goes,
 * the callover and its other rows stay, audit_log keeps the removed row).
 *
 * Creates its own district, courts, users and rows (all carrying the fixture
 * mark) and removes every one of them afterwards, pass or fail.
 *
 *   npm run db:start && npm run test:callover-record-integrity
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-callover-record-integrity");
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

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

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(URL, SERVICE, noSession);
const MARK = `T3-FIX-${Date.now() % 1_000_000}`;
const PASSWORD = "T3-fixture-pass-123!";
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

async function calloverRow(id) {
  return must(
    await admin
      .from("docket_callovers")
      .select("status, title, court_id")
      .eq("id", id)
      .maybeSingle(),
    "read callover",
  );
}

async function itemRow(id) {
  return must(
    await admin
      .from("docket_callover_items")
      .select("callover_id, docket_matter_id, called_at, outcome, notes")
      .eq("id", id)
      .maybeSingle(),
    "read item",
  );
}

async function itemCount(calloverId) {
  const rows = must(
    await admin.from("docket_callover_items").select("id").eq("callover_id", calloverId),
    "count items",
  );
  return rows.length;
}

/** Same instant, whatever text form PostgREST returned it in. */
const sameInstant = (a, b) => new Date(a).getTime() === new Date(b).getTime();

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
  const a1 = await createUser("a1", "admin");
  must(
    await admin.from("magistrate_courts").insert([
      { profile_id: m1.id, court_id: courtA },
      { profile_id: m2.id, court_id: courtA },
      { profile_id: m3.id, court_id: courtB },
    ]),
    "seat magistrates",
  );

  const M1 = await signIn(m1);
  const M2 = await signIn(m2);
  const M3 = await signIn(m3);
  const A1 = await signIn(a1);

  let seq = 0;
  const newMatter = async (client, courtId) =>
    must(
      await client
        .from("docket_matters")
        .insert({
          court_id: courtId,
          case_number: `${MARK}-${(seq += 1)}`,
          matter_title: `Police v. ${MARK} accused ${seq}`,
          charge_or_issue: "Larceny",
        })
        .select()
        .single(),
      "create matter",
    );
  const newCallover = async (client, courtId, days) =>
    must(
      await client
        .from("docket_callovers")
        .insert({ court_id: courtId, callover_date: weekdayAhead(days), title: `${MARK} sitting` })
        .select()
        .single(),
      "create callover",
    );
  const addItem = (client, calloverId, matterId, sortOrder) =>
    client
      .from("docket_callover_items")
      .insert({ callover_id: calloverId, docket_matter_id: matterId, sort_order: sortOrder })
      .select()
      .single();
  const patchItem = (client, id, values) =>
    client.from("docket_callover_items").update(values).eq("id", id).select().single();
  const patchCallover = (client, id, values) =>
    client.from("docket_callovers").update(values).eq("id", id).select().single();

  // ---------- controls: a draft is a working sheet ----------
  const day = 500 + Math.floor(Math.random() * 200);
  const listed = await newMatter(M1, courtA);
  const handAdded = await newMatter(M1, courtA);
  const removable = await newMatter(M1, courtA);
  must(
    await M1.rpc("set_docket_matter_next_date", {
      p_docket_matter_id: listed.id,
      p_scheduled_date: weekdayAhead(day),
    }),
    "next date",
  );
  const sitting = await newCallover(M1, courtA, day);
  check("control: a magistrate creates a callover as a draft", sitting.status, "draft");
  check(
    "control: filling the draft from the day's list adds the listed matter",
    must(await M1.rpc("populate_callover_from_date", { p_callover_id: sitting.id }), "populate"),
    1,
  );
  const item = must(
    await M1.from("docket_callover_items")
      .select("id")
      .eq("callover_id", sitting.id)
      .eq("docket_matter_id", listed.id)
      .single(),
    "populated item",
  );
  const second = await addItem(M2, sitting.id, handAdded.id, 2);
  check("control: a colleague adds a matter by hand to the draft", refused(second), "allowed");
  const third = await addItem(M1, sitting.id, removable.id, 3);
  check("control: a third matter is added", refused(third), "allowed");
  check(
    "control: an uncalled row is removed from the draft",
    refused(await M2.from("docket_callover_items").delete().eq("id", third.data.id).select("id")),
    "allowed",
  );
  check("control: the removed row is gone", await itemRow(third.data.id), null);

  const firstCall = new Date(Date.now() - 60_000).toISOString();
  check(
    "control: a colleague calls a row on the draft with an outcome",
    refused(await patchItem(M2, item.id, { called_at: firstCall, outcome: "Adjourned" })),
    "allowed",
  );
  check(
    "control: a called row on the draft stays editable (outcome, notes, next date)",
    refused(
      await patchItem(M1, item.id, {
        outcome: "Trial date set",
        notes: "Trial fixed",
        next_date: weekdayAhead(day + 30),
      }),
    ),
    "allowed",
  );

  // ---------- B-08: a recorded call is never cleared ----------
  check(
    "B-08: a recorded call cannot be cleared, even on a draft",
    refused(await patchItem(M2, item.id, { called_at: null })),
    "refused",
  );
  check(
    "B-08 control: re-stamping a called row from a stale screen is accepted",
    refused(await patchItem(M2, item.id, { called_at: new Date().toISOString() })),
    "allowed",
  );
  check(
    "B-08: the row keeps the time it was first called",
    sameInstant((await itemRow(item.id)).called_at, firstCall),
    true,
  );
  check(
    "B-08: a called row is still not removable",
    (await M2.from("docket_callover_items").delete().eq("id", item.id).select("id")).data?.length ??
      0,
    0,
  );

  // ---------- B-08: a draft with a called matter is a record ----------
  {
    // Its own sheet, so the rest of the run keeps its callover if this fails.
    const calledDraft = await newCallover(M1, courtA, day + 35);
    const calledRow = must(await addItem(M1, calledDraft.id, listed.id, 1), "called draft item");
    must(
      await patchItem(M1, calledRow.id, { called_at: new Date().toISOString(), outcome: "Called" }),
      "call it",
    );
    check(
      "B-08: a draft callover with a called matter cannot be deleted",
      refused(await M2.from("docket_callovers").delete().eq("id", calledDraft.id).select("id")),
      "refused",
    );
    check(
      "B-08: the callover and its called row are still there",
      [(await calloverRow(calledDraft.id))?.status, await itemCount(calledDraft.id)],
      ["draft", 1],
    );
  }
  {
    const spare = await newCallover(M1, courtA, day + 7);
    must(await addItem(M1, spare.id, handAdded.id, 1), "spare item");
    check(
      "control: a draft nobody was called on is deleted, rows and all",
      refused(await M2.from("docket_callovers").delete().eq("id", spare.id).select("id")),
      "allowed",
    );
    check(
      "control: the deleted draft and its row are gone",
      [await calloverRow(spare.id), await itemCount(spare.id)],
      [null, 0],
    );
  }

  // ---------- B-08: status moves forward only ----------
  check(
    "control: the draft is started (in progress)",
    refused(await patchCallover(M1, sitting.id, { status: "in_progress" })),
    "allowed",
  );
  check(
    "B-08: an in-progress callover cannot be set back to draft",
    refused(await patchCallover(M2, sitting.id, { status: "draft" })),
    "refused",
  );
  check(
    "control: an in-progress row stays editable",
    refused(await patchItem(M2, item.id, { outcome: "Adjourned", notes: "Adjourned for trial" })),
    "allowed",
  );
  check(
    "control: a matter is called in progress",
    refused(
      await patchItem(M1, second.data.id, {
        called_at: new Date().toISOString(),
        outcome: "Called",
      }),
    ),
    "allowed",
  );
  const pending = await newMatter(M1, courtA);
  const uncalled = await addItem(M2, sitting.id, pending.id, 4);
  check("control: a matter is added to the sheet in progress", refused(uncalled), "allowed");
  check(
    "control: the in-progress callover is completed",
    refused(await patchCallover(M1, sitting.id, { status: "completed" })),
    "allowed",
  );

  // ---------- B-08: the audit repro against the completed callover ----------
  // A matter newly listed on the sitting day, so a refill has a row to add.
  must(
    await M1.rpc("set_docket_matter_next_date", {
      p_docket_matter_id: removable.id,
      p_scheduled_date: weekdayAhead(day),
    }),
    "late listing",
  );
  const before = await itemRow(item.id);
  const attempts = [
    ["rewrite an outcome", (c) => patchItem(c, item.id, { outcome: "Struck out" })],
    ["clear a call", (c) => patchItem(c, item.id, { called_at: null })],
    ["change a row's notes", (c) => patchItem(c, item.id, { notes: "rewritten later" })],
    [
      "remove a row that was never called",
      (c) => c.from("docket_callover_items").delete().eq("id", uncalled.data.id).select(),
    ],
    ["add a row", (c) => addItem(c, sitting.id, removable.id, 9)],
    ["set it back to draft", (c) => patchCallover(c, sitting.id, { status: "draft" })],
    ["reopen it (in progress)", (c) => patchCallover(c, sitting.id, { status: "in_progress" })],
    ["retitle it", (c) => patchCallover(c, sitting.id, { title: "Rewritten" })],
  ];
  for (const [who, client] of [
    ["a colleague at the court", M2],
    ["an administrator", A1],
  ]) {
    for (const [what, run] of attempts) {
      check(
        `B-08: ${who} cannot ${what} on a completed callover`,
        refused(await run(client)),
        "refused",
      );
    }
    const deleted = await client
      .from("docket_callovers")
      .delete()
      .eq("id", sitting.id)
      .select("id");
    check(
      `B-08: ${who} cannot delete a completed callover`,
      deleted.error ? "refused" : `${deleted.data.length} deleted`,
      "0 deleted",
    );
  }
  check(
    "B-08: a colleague cannot refill a completed callover from the day's list",
    refused(await M2.rpc("populate_callover_from_date", { p_callover_id: sitting.id })),
    "refused",
  );
  const after = await itemRow(item.id);
  check("B-08: the completed sheet is exactly as it was", after, before);
  check(
    "B-08: the completed callover still stands, with all three rows",
    [(await calloverRow(sitting.id))?.status, await itemCount(sitting.id)],
    ["completed", 3],
  );

  {
    const quick = await newCallover(M1, courtA, day + 14);
    must(await addItem(M1, quick.id, removable.id, 1), "quick item");
    check(
      "control: a draft is completed directly (the app's Mark completed)",
      refused(await patchCallover(M2, quick.id, { status: "completed" })),
      "allowed",
    );
  }

  // ---------- B-09: an item's matter, callover and a callover's court are fixed ----------
  {
    const aMatter = await newMatter(M1, courtA);
    const bMatter = await newMatter(M3, courtB);
    const bOther = await newMatter(M3, courtB);
    const bSitting = await newCallover(M3, courtB, day + 21);
    const bItem = must(await addItem(M3, bSitting.id, bMatter.id, 1), "B item");
    check(
      "B-09 control: another court's matter still cannot be added to the sheet",
      refused(await addItem(M3, bSitting.id, aMatter.id, 2)),
      "refused",
    );
    check(
      "B-09: a row cannot be re-pointed at another court's matter",
      refused(
        await patchItem(M3, bItem.id, { docket_matter_id: aMatter.id, outcome: "Struck out" }),
      ),
      "refused",
    );
    check(
      "B-09: a row cannot be re-pointed at the caller's own other matter either",
      refused(await patchItem(M3, bItem.id, { docket_matter_id: bOther.id })),
      "refused",
    );
    check(
      "B-09: the row still lists the original matter",
      (await itemRow(bItem.id)).docket_matter_id,
      bMatter.id,
    );
    const bSecond = await newCallover(M3, courtB, day + 28);
    check(
      "B-09: a row cannot be moved to another callover",
      refused(await patchItem(M3, bItem.id, { callover_id: bSecond.id })),
      "refused",
    );
    check(
      "B-09: a callover cannot be moved to another court, even by an administrator",
      refused(await patchCallover(A1, bSitting.id, { court_id: courtA })),
      "refused",
    );
    check(
      "B-09 control: the draft row's own fields stay editable",
      refused(await patchItem(M3, bItem.id, { outcome: "Adjourned", notes: "ok" })),
      "allowed",
    );
  }

  // ---------- control: the authorised permanent delete still works ----------
  {
    must(await M1.rpc("bin_docket_matter", { p_id: handAdded.id }), "bin matter");
    check(
      "control: a binned matter on a completed callover is permanently deleted",
      refused(await M1.rpc("purge_docket_matter", { p_id: handAdded.id })),
      "allowed",
    );
    const gone = must(
      await admin.from("docket_matters").select("id").eq("id", handAdded.id),
      "read purged",
    );
    check("control: the matter is gone", gone.length, 0);
    check("control: only its row left the completed callover", await itemCount(sitting.id), 2);
    check(
      "control: the completed callover and its other rows stay",
      [(await calloverRow(sitting.id))?.status, (await itemRow(item.id))?.outcome],
      ["completed", "Adjourned"],
    );
    const audit = must(
      await admin
        .from("audit_log")
        .select("action, old_data")
        .eq("table_name", "docket_callover_items")
        .eq("record_id", second.data.id)
        .eq("action", "delete"),
      "audit",
    );
    check(
      "control: audit_log keeps the removed row with its outcome",
      audit.map((r) => [r.old_data?.docket_matter_id, r.old_data?.outcome]),
      [[handAdded.id, "Called"]],
    );
  }

  console.log(
    failures > 0 ? `\n${failures} failure(s).` : "\nAll callover record integrity tests passed.",
  );
}

async function cleanup() {
  try {
    for (const courtId of created.courts) {
      const { data: callovers } = await admin
        .from("docket_callovers")
        .select("id")
        .eq("court_id", courtId);
      const calloverIds = callovers?.map((r) => r.id) ?? [];
      if (calloverIds.length > 0) {
        await admin.from("docket_callover_items").delete().in("callover_id", calloverIds);
        await admin.from("docket_callovers").delete().in("id", calloverIds);
      }
      const { data: leftover } = await admin
        .from("docket_matters")
        .select("id")
        .eq("court_id", courtId);
      const ids = leftover?.map((r) => r.id) ?? [];
      if (ids.length > 0) {
        await admin.from("docket_events").delete().in("docket_matter_id", ids);
        await admin.from("docket_matters").delete().in("id", ids);
      }
      await admin.from("magistrate_courts").delete().eq("court_id", courtId);
      await admin.from("courts").delete().eq("id", courtId);
    }
    if (created.districtId)
      await admin.from("magisterial_districts").delete().eq("id", created.districtId);
    if (created.users.length > 0)
      await admin.from("notifications").delete().in("user_id", created.users);
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
