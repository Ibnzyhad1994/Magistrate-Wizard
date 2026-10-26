// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * Docket scheduling, capacity and presiding hold under real use (0163), on
 * a real database.
 *
 * Replays the 2026-10-15 audit's theme T2 repros through the same clients
 * the app uses:
 *
 *   B-03  two magistrates adjourning one matter at once leave exactly one
 *         live next date (repeated concurrent trials);
 *   B-05  two bookings racing for the last slot: one is refused, or, when
 *         both acknowledge the override, the over-capacity one is recorded
 *         (repeated concurrent trials);
 *   B-06  a clerk's listing goes to the sitting magistrate (never the
 *         clerk), counts against that magistrate's capacity, and an
 *         unassigned hearing can be taken by a court magistrate;
 *   B-07  nobody can remove or reassign a hearing's presiding magistrate,
 *         and every editor can still record outcomes, on unassigned
 *         hearings too; deleting the presiding profile still nulls it;
 *   B-11  the booking, the calendar snapshot and the next-free-day
 *         suggestion agree (adjourned sittings fill the day, binned
 *         matters do not, a clerk's suggestion uses the magistrate's
 *         capacity);
 *   B-12  a stale hearing edit is refused as a conflict instead of wiping
 *         orders recorded meanwhile, on the RPC and the direct update.
 *
 * Controls show legitimate scheduling, overrides, clerk listing and
 * magistrate edits still work, including the RPC's older call shape.
 *
 * Creates its own district, courts, users and rows (all carrying the fixture
 * mark) and removes every one of them afterwards, pass or fail.
 *
 *   npm run db:start && npm run test:docket-scheduling-integrity
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-docket-scheduling-integrity");
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
/** A PATCH that RLS filters out returns no error and no rows. */
const wrote = ({ data, error }) =>
  error ? "refused" : (data ?? []).length > 0 ? "written" : "no row";
const statusOf = (r) => (r.error ? `error: ${r.error.message}` : r.data?.[0]?.status);

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(URL, SERVICE, noSession);
const MARK = `T2-FIX-${Date.now() % 1_000_000}`;
const PASSWORD = "T2-fixture-pass-123!";
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

/** The weekday `days` ahead (or the next one after it), as YYYY-MM-DD. */
function weekdayAhead(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** A fresh far-future weekday per call, so trials never share a day. */
let dayCursor = 400;
const freshDay = () => weekdayAhead((dayCursor += 7));

const eventsOf = async (matterId) =>
  must(
    await admin
      .from("docket_events")
      .select("id, scheduled_date, event_status, outcome_at_event, presiding_magistrate_id")
      .eq("docket_matter_id", matterId)
      .order("created_at"),
    "read events",
  );
const eventRow = async (id) =>
  must(await admin.from("docket_events").select("*").eq("id", id).single(), "read event");

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
  // Court A sits two magistrates; Court S has one, so a clerk's listing
  // there has an obvious sitting magistrate even on a brand-new matter.
  const courtA = await court("Court A");
  const courtB = await court("Court B");
  const courtS = await court("Court S");

  const m1 = await createUser("m1", "magistrate");
  const m2 = await createUser("m2", "magistrate");
  const m3 = await createUser("m3", "magistrate");
  const ms = await createUser("ms", "magistrate");
  const c1 = await createUser("c1", "clerk");
  const cs = await createUser("cs", "clerk");
  must(
    await admin.from("magistrate_courts").insert([
      { profile_id: m1.id, court_id: courtA },
      { profile_id: m2.id, court_id: courtA },
      { profile_id: m3.id, court_id: courtB },
      { profile_id: ms.id, court_id: courtS },
    ]),
    "seat magistrates",
  );
  must(
    await admin.from("clerk_courts").insert([
      { profile_id: c1.id, court_id: courtA, approved_by: m1.id },
      { profile_id: cs.id, court_id: courtS, approved_by: m1.id },
    ]),
    "attach clerks",
  );

  const M1 = await signIn(m1);
  const M2 = await signIn(m2);
  const M3 = await signIn(m3);
  const MS = await signIn(ms);
  const C1 = await signIn(c1);
  const CS = await signIn(cs);

  const categories = Object.fromEntries(
    must(await admin.from("docket_matter_categories").select("id, name"), "categories").map((c) => [
      c.name,
      c.id,
    ]),
  );
  const LIABILITY = categories["Liability matter"];
  const PROTECTION = categories["Protection order matter"];
  const OTHER = categories["Other"];

  let seq = 0;
  const newMatter = async ({ client = M1, courtId = courtA, categoryId = null } = {}) =>
    must(
      await client
        .from("docket_matters")
        .insert({
          court_id: courtId,
          case_number: `${MARK}-${(seq += 1)}`,
          matter_title: `Police v. ${MARK} accused ${seq}`,
          charge_or_issue: "Larceny",
          category_id: categoryId,
          category_other: categoryId === OTHER ? "Fixture" : null,
        })
        .select()
        .single(),
      "create matter",
    );
  const setNextDate = (client, id, date, extra = {}) =>
    client.rpc("set_docket_matter_next_date", {
      p_docket_matter_id: id,
      p_scheduled_date: date,
      ...extra,
    });
  const schedule = (client, id, date, extra = {}) =>
    client.rpc("schedule_docket_event_with_capacity", {
      p_docket_matter_id: id,
      p_scheduled_date: date,
      p_event_status: "scheduled",
      p_event_type: "Hearing",
      ...extra,
    });
  const setCapacity = async (client, categoryId, dailyCapacity) =>
    must(
      await client
        .from("docket_capacity_settings")
        .upsert(
          { category_id: categoryId, daily_capacity: dailyCapacity },
          { onConflict: "owner_id,category_id" },
        ),
      "capacity setting",
    );
  const snapshot = async (client, date, categoryId) =>
    must(
      await client.rpc("get_docket_capacity_snapshot", {
        p_scheduled_date: date,
        p_category_id: categoryId,
      }),
      "snapshot",
    )[0];
  const findNext = async (client, categoryId, startDate, matterId) =>
    must(
      await client.rpc("find_next_available_docket_date", {
        p_category_id: categoryId,
        p_start_date: startDate,
        ...(matterId ? { p_docket_matter_id: matterId } : {}),
      }),
      "find next",
    );
  // select("*") so a database without overridden_by fails the check
  // rather than the whole run.
  const overridesOn = async (date) =>
    must(
      await admin.from("docket_capacity_overrides").select("*").eq("scheduled_date", date),
      "overrides",
    ).map((o) => ({
      magistrate_profile_id: o.magistrate_profile_id,
      overridden_by: o.overridden_by,
      scheduled_count_at_override: o.scheduled_count_at_override,
    }));
  const bookedOn = async (date, categoryId, presidingId) =>
    must(
      await admin
        .from("docket_events")
        .select("docket_matter_id")
        .eq("scheduled_date", date)
        .eq("category_id", categoryId)
        .eq("presiding_magistrate_id", presidingId)
        .in("event_status", ["scheduled", "completed"]),
      "booked",
    ).length;

  // ---------- B-03: concurrent adjournments leave one live next date ----------
  {
    const matter = await newMatter();
    must(await setNextDate(M1, matter.id, weekdayAhead(10)), "first next date");
    must(await setNextDate(M1, matter.id, weekdayAhead(17)), "adjourn");
    const events = await eventsOf(matter.id);
    check(
      "B-03 control: a sequential adjournment completes the old sitting and leaves one live date",
      events.map((e) => e.event_status),
      ["completed", "scheduled"],
    );

    const tally = {};
    let doubleLive = 0;
    let errors = 0;
    for (let i = 0; i < RACE_TRIALS; i += 1) {
      const raced = await newMatter();
      must(await setNextDate(M1, raced.id, weekdayAhead(10)), "first next date");
      const [a, b] = await Promise.all([
        setNextDate(M1, raced.id, weekdayAhead(20)),
        setNextDate(M2, raced.id, weekdayAhead(27)),
      ]);
      if (a.error || b.error) errors += 1;
      const live = (await eventsOf(raced.id)).filter((e) => e.event_status === "scheduled");
      const key = `M1=${statusOf(a)} M2=${statusOf(b)} live=${live.length}`;
      tally[key] = (tally[key] ?? 0) + 1;
      if (live.length !== 1) doubleLive += 1;
    }
    console.log("  race outcomes:", JSON.stringify(tally));
    check(`B-03: both adjournments succeed (${RACE_TRIALS} races)`, errors, 0);
    check(
      `B-03: every race leaves exactly one live next date (${RACE_TRIALS} races)`,
      doubleLive,
      0,
    );
  }

  // ---------- B-05: the last slot cannot be booked twice ----------
  {
    await setCapacity(M1, LIABILITY, 2);
    const day = freshDay();
    const [a, b, c] = [
      await newMatter({ categoryId: LIABILITY }),
      await newMatter({ categoryId: LIABILITY }),
      await newMatter({ categoryId: LIABILITY }),
    ];
    check(
      "B-05 control: bookings within capacity are created",
      [
        statusOf(await schedule(M1, a.id, day, { p_category_id: LIABILITY })),
        statusOf(await setNextDate(M1, b.id, day, { p_category_id: LIABILITY })),
      ],
      ["created", "created"],
    );
    check(
      "B-05 control: a booking past capacity is refused",
      statusOf(await schedule(M1, c.id, day, { p_category_id: LIABILITY })),
      "capacity_reached",
    );
    check(
      "B-05 control: an acknowledged override is created",
      statusOf(
        await schedule(M1, c.id, day, {
          p_category_id: LIABILITY,
          p_acknowledge_override: true,
          p_override_reason: "Directed same-day hearing",
        }),
      ),
      "created",
    );
    check("B-05 control: the override is recorded against M1, by M1", await overridesOn(day), [
      { magistrate_profile_id: m1.id, overridden_by: m1.id, scheduled_count_at_override: 3 },
    ]);

    const tally = {};
    let overbooked = 0;
    let unrecorded = 0;
    for (let i = 0; i < RACE_TRIALS; i += 1) {
      const raceDay = freshDay();
      const ms3 = [
        await newMatter({ categoryId: LIABILITY }),
        await newMatter({ categoryId: LIABILITY }),
        await newMatter({ categoryId: LIABILITY }),
      ];
      must(await schedule(M1, ms3[0].id, raceDay, { p_category_id: LIABILITY }), "first booking");
      // Two tabs: the event dialog and the board's next-date cell.
      const [x, y] = await Promise.all([
        schedule(M1, ms3[1].id, raceDay, { p_category_id: LIABILITY }),
        setNextDate(M1, ms3[2].id, raceDay, { p_category_id: LIABILITY }),
      ]);
      const outcome = [statusOf(x), statusOf(y)].sort().join("/");
      const booked = await bookedOn(raceDay, LIABILITY, m1.id);
      tally[`${outcome} booked=${booked}`] = (tally[`${outcome} booked=${booked}`] ?? 0) + 1;
      if (outcome !== "capacity_reached/created" || booked !== 2) overbooked += 1;

      // Both acknowledge the override at once: both land, and the one that
      // went over capacity is on record.
      const overDay = freshDay();
      must(await schedule(M1, ms3[0].id, overDay, { p_category_id: LIABILITY }), "first booking");
      const ack = { p_category_id: LIABILITY, p_acknowledge_override: true };
      const [p, q] = await Promise.all([
        schedule(M1, ms3[1].id, overDay, ack),
        setNextDate(M1, ms3[2].id, overDay, ack),
      ]);
      const overrides = await overridesOn(overDay);
      if (
        statusOf(p) !== "created" ||
        statusOf(q) !== "created" ||
        (await bookedOn(overDay, LIABILITY, m1.id)) !== 3 ||
        overrides.length !== 1 ||
        overrides[0].scheduled_count_at_override !== 3
      ) {
        unrecorded += 1;
      }
    }
    console.log("  race outcomes:", JSON.stringify(tally));
    check(
      `B-05: racing for the last slot, one booking is created and one refused (${RACE_TRIALS} races)`,
      overbooked,
      0,
    );
    check(
      `B-05: racing acknowledged overrides, the over-capacity booking is recorded (${RACE_TRIALS} races)`,
      unrecorded,
      0,
    );
  }

  // ---------- B-06: a clerk's listing goes to the sitting magistrate ----------
  let unassignedEvent = null;
  {
    await setCapacity(M1, PROTECTION, 1);
    const day = freshDay();
    const own = await newMatter({ categoryId: PROTECTION });
    const heard = await newMatter({ categoryId: PROTECTION });
    // `heard` already sits before M1; the clerk adjourns it onto M1's full day.
    must(await setNextDate(M1, heard.id, weekdayAhead(12)), "M1 hears it first");
    check(
      "B-06 control: M1 books their own day",
      statusOf(await setNextDate(M1, own.id, day)),
      "created",
    );

    const clerkBooking = await setNextDate(C1, heard.id, day);
    check(
      "B-06: the clerk's listing on M1's full day is checked against M1's capacity",
      [statusOf(clerkBooking), clerkBooking.data?.[0]?.configured_capacity],
      ["capacity_reached", 1],
    );
    const clerkOverride = await setNextDate(C1, heard.id, day, {
      p_acknowledge_override: true,
      p_override_reason: "Listed by the clerk on the magistrate's instruction",
    });
    check(
      "B-06 control: the clerk can acknowledge the override",
      statusOf(clerkOverride),
      "created",
    );
    const listed = await eventRow(clerkOverride.data[0].event_id);
    check(
      "B-06: the clerk-listed hearing presides with M1 (its last sitting), never the clerk",
      listed.presiding_magistrate_id,
      m1.id,
    );
    check("B-06: the clerk is still recorded as who listed it", listed.created_by, c1.id);
    check(
      "B-06: the override is on M1's capacity, acknowledged by the clerk",
      await overridesOn(day),
      [{ magistrate_profile_id: m1.id, overridden_by: c1.id, scheduled_count_at_override: 2 }],
    );
    const tile = await snapshot(M1, day, PROTECTION);
    check(
      "B-06: M1's calendar counts the clerk's listing",
      [tile.scheduled_count, tile.status],
      [2, "over_capacity"],
    );
    check(
      "B-06: the clerk can see the override they made",
      must(
        await C1.from("docket_capacity_overrides").select("id").eq("scheduled_date", day),
        "read",
      ).length,
      1,
    );

    // A brand-new matter at a two-magistrate court: no one to guess.
    const fresh = await newMatter({ client: C1, categoryId: PROTECTION });
    const unassigned = await setNextDate(C1, fresh.id, day);
    check(
      "B-06: with several magistrates and no earlier sitting the listing is created",
      statusOf(unassigned),
      "created",
    );
    unassignedEvent = unassigned.data[0].event_id;
    check(
      "B-06: ... and left unassigned rather than presided by the clerk",
      (await eventRow(unassignedEvent)).presiding_magistrate_id,
      null,
    );
    const direct = must(
      await C1.from("docket_events")
        .insert({
          docket_matter_id: fresh.id,
          scheduled_date: freshDay(),
          event_status: "scheduled",
        })
        .select("id, presiding_magistrate_id")
        .single(),
      "clerk direct insert",
    );
    check(
      "B-06: a clerk's direct insert is unassigned too, not the clerk",
      direct.presiding_magistrate_id,
      null,
    );
    const spoofed = must(
      await C1.from("docket_events")
        .insert({
          docket_matter_id: fresh.id,
          scheduled_date: freshDay(),
          event_status: "scheduled",
          presiding_magistrate_id: c1.id,
        })
        .select("presiding_magistrate_id")
        .single(),
      "clerk spoofed insert",
    );
    check(
      "B-06: a clerk cannot name themselves presiding on insert",
      spoofed.presiding_magistrate_id,
      null,
    );

    // Taking an unassigned hearing.
    check(
      "B-06: a clerk cannot take an unassigned hearing",
      refused(
        await C1.from("docket_events")
          .update({ presiding_magistrate_id: c1.id })
          .eq("id", direct.id)
          .select("id"),
      ),
      "refused",
    );
    check(
      "B-06: a magistrate cannot assign it to someone else",
      refused(
        await M1.from("docket_events")
          .update({ presiding_magistrate_id: m2.id })
          .eq("id", direct.id)
          .select("id"),
      ),
      "refused",
    );
    must(
      await M1.from("shares").insert({
        item_type: "docket_matter",
        item_id: fresh.id,
        recipient_id: m3.id,
        granted_by: m1.id,
        permission: "edit",
      }),
      "edit share to M3",
    );
    check(
      "B-06: an edit-share recipient from another court cannot take it",
      refused(
        await M3.from("docket_events")
          .update({ presiding_magistrate_id: m3.id })
          .eq("id", direct.id)
          .select("id"),
      ),
      "refused",
    );
    check(
      "B-06: a magistrate of the court takes the unassigned hearing for themselves",
      wrote(
        await M2.from("docket_events")
          .update({ presiding_magistrate_id: m2.id })
          .eq("id", direct.id)
          .select("id"),
      ),
      "written",
    );
    check(
      "B-06: ... and it is theirs (the old guard silently ignored this)",
      (await eventRow(direct.id)).presiding_magistrate_id,
      m2.id,
    );

    // A single-magistrate court: the clerk's listing goes to that magistrate.
    await setCapacity(MS, OTHER, 1);
    const sDay = freshDay();
    const sFirst = await newMatter({ client: CS, courtId: courtS, categoryId: OTHER });
    const sSecond = await newMatter({ client: CS, courtId: courtS, categoryId: OTHER });
    const sListed = await setNextDate(CS, sFirst.id, sDay);
    check(
      "B-06: at a one-magistrate court the clerk's listing presides with that magistrate",
      (await eventRow(sListed.data[0].event_id)).presiding_magistrate_id,
      ms.id,
    );
    check(
      "B-06: ... and a second listing that day meets that magistrate's capacity",
      statusOf(await setNextDate(CS, sSecond.id, sDay)),
      "capacity_reached",
    );
    check(
      "B-06: ... through the event dialog's RPC too",
      statusOf(await schedule(CS, sSecond.id, sDay, { p_category_id: OTHER })),
      "capacity_reached",
    );
    const sDirect = must(
      await CS.from("docket_events")
        .insert({
          docket_matter_id: sSecond.id,
          scheduled_date: freshDay(),
          event_status: "scheduled",
        })
        .select("presiding_magistrate_id")
        .single(),
      "clerk direct insert at Court S",
    );
    check(
      "B-06: ... and a clerk's direct insert there too",
      sDirect.presiding_magistrate_id,
      ms.id,
    );

    check(
      "B-06 control: a magistrate listing a hearing presides over it",
      (await eventRow(must(await setNextDate(M2, own.id, freshDay()), "M2 lists")[0].event_id))
        .presiding_magistrate_id,
      m2.id,
    );
    const clerkPresided = must(
      await admin.from("docket_events").select("id").in("presiding_magistrate_id", [c1.id, cs.id]),
      "clerk presided",
    );
    check("B-06: no hearing anywhere in the run presides with a clerk", clerkPresided.length, 0);
  }

  // ---------- B-07: presiding cannot be stripped; editors keep editing ----------
  {
    const matter = await newMatter();
    const eventId = must(await setNextDate(M1, matter.id, weekdayAhead(33)), "next date")[0]
      .event_id;
    check(
      "B-07: a clerk cannot remove the presiding magistrate",
      refused(
        await C1.from("docket_events")
          .update({ presiding_magistrate_id: null })
          .eq("id", eventId)
          .select("id"),
      ),
      "refused",
    );
    check(
      "B-07: nor can the presiding magistrate themselves",
      refused(
        await M1.from("docket_events")
          .update({ presiding_magistrate_id: null })
          .eq("id", eventId)
          .select("id"),
      ),
      "refused",
    );
    check(
      "B-07: another magistrate cannot reassign it",
      refused(
        await M2.from("docket_events")
          .update({ presiding_magistrate_id: m2.id })
          .eq("id", eventId)
          .select("id"),
      ),
      "refused",
    );
    check("B-07: M1 still presides", (await eventRow(eventId)).presiding_magistrate_id, m1.id);
    for (const [label, client] of [
      ["M1", M1],
      ["M2", M2],
      ["the clerk", C1],
    ]) {
      check(
        `B-07 control: ${label} records an outcome on the hearing`,
        wrote(
          await client
            .from("docket_events")
            .update({ outcome_at_event: `Bail extended (${label})` })
            .eq("id", eventId)
            .select("id"),
        ),
        "written",
      );
    }
    check(
      "B-07: a magistrate records an outcome on an unassigned hearing without taking it",
      wrote(
        await M1.from("docket_events")
          .update({ outcome_at_event: "Mention, unassigned" })
          .eq("id", unassignedEvent)
          .select("id"),
      ),
      "written",
    );
    check(
      "B-07: ... and it stays unassigned",
      (await eventRow(unassignedEvent)).presiding_magistrate_id,
      null,
    );

    // The profile's own ON DELETE SET NULL still goes through the guard.
    const gone = await createUser("gone", "magistrate");
    const cg = await createUser("cg", "clerk");
    const courtG = await court("Court G");
    must(
      await admin.from("magistrate_courts").insert({ profile_id: gone.id, court_id: courtG }),
      "seat",
    );
    must(
      await admin
        .from("clerk_courts")
        .insert({ profile_id: cg.id, court_id: courtG, approved_by: m1.id }),
      "attach clerk to Court G",
    );
    const CG = await signIn(cg);
    const gMatter = await newMatter({ client: CG, courtId: courtG });
    const gEvent = must(await setNextDate(CG, gMatter.id, weekdayAhead(40)), "clerk lists")[0]
      .event_id;
    check(
      "B-07 setup: the hearing presides with Court G's magistrate",
      (await eventRow(gEvent)).presiding_magistrate_id,
      gone.id,
    );
    must(await admin.auth.admin.deleteUser(gone.id), "delete the presiding magistrate");
    created.users = created.users.filter((id) => id !== gone.id);
    check(
      "B-07 control: deleting the presiding profile still nulls it (FK ON DELETE SET NULL)",
      (await eventRow(gEvent)).presiding_magistrate_id,
      null,
    );
  }

  // ---------- B-11: one count for booking, calendar and suggestion ----------
  {
    await setCapacity(M1, OTHER, 2);
    // (1) An adjourned sitting stays completed on its day and still fills it.
    const d2 = freshDay();
    const [z1, z2, z3] = [
      await newMatter({ categoryId: OTHER }),
      await newMatter({ categoryId: OTHER }),
      await newMatter({ categoryId: OTHER }),
    ];
    must(await setNextDate(M1, z1.id, d2), "z1");
    must(await setNextDate(M1, z2.id, d2), "z2");
    must(await setNextDate(M1, z2.id, freshDay()), "z2 adjourned onward");
    const filled = await snapshot(M1, d2, OTHER);
    check(
      "B-11: the calendar counts the adjourned sitting",
      [filled.scheduled_count, filled.status],
      [2, "full"],
    );
    check(
      "B-11: booking that day is refused, as the calendar says",
      statusOf(await setNextDate(M1, z3.id, d2)),
      "capacity_reached",
    );
    const suggested = await findNext(M1, OTHER, d2);
    check("B-11: the suggested free day is not the full day", suggested !== d2, true);
    check(
      "B-11: the suggested free day is accepted",
      statusOf(await setNextDate(M1, z3.id, suggested)),
      "created",
    );

    // (2) A binned matter's hearing no longer fills the day anywhere.
    const d3 = freshDay();
    const [w1, w2, w3] = [
      await newMatter({ categoryId: OTHER }),
      await newMatter({ categoryId: OTHER }),
      await newMatter({ categoryId: OTHER }),
    ];
    must(await setNextDate(M1, w1.id, d3), "w1");
    must(await setNextDate(M1, w2.id, d3), "w2");
    must(await M1.rpc("bin_docket_matter", { p_id: w2.id }), "bin w2");
    const freed = await snapshot(M1, d3, OTHER);
    check(
      "B-11: the calendar shows the binned matter's slot free",
      [freed.scheduled_count, freed.status],
      [1, "available"],
    );
    check("B-11: the suggestion agrees", await findNext(M1, OTHER, d3), d3);
    const third = await setNextDate(M1, w3.id, d3);
    check(
      "B-11: booking the free slot is accepted",
      [statusOf(third), third.data?.[0]?.scheduled_count],
      ["created", 2],
    );
    const nowFull = await snapshot(M1, d3, OTHER);
    check(
      "B-11: the calendar then says full",
      [nowFull.scheduled_count, nowFull.status],
      [2, "full"],
    );

    // (3) A clerk is offered a day the sitting magistrate has free.
    const d4 = freshDay();
    const [v1, v2, v3] = [
      await newMatter({ categoryId: OTHER }),
      await newMatter({ categoryId: OTHER }),
      await newMatter({ categoryId: OTHER }),
    ];
    must(await setNextDate(M1, v1.id, d4), "v1");
    must(await setNextDate(M1, v2.id, d4), "v2");
    must(await setNextDate(M1, v3.id, weekdayAhead(14)), "v3 sits before M1");
    const clerkSuggestion = await findNext(C1, OTHER, d4, v3.id);
    check(
      "B-11: the clerk's suggestion for M1's matter skips M1's full day",
      clerkSuggestion !== d4,
      true,
    );
    check(
      "B-11: ... and the clerk's booking there is accepted",
      statusOf(await setNextDate(C1, v3.id, clerkSuggestion)),
      "created",
    );
    check(
      "B-11 control: without a matter the suggestion is the caller's own (the clerk has no capacity)",
      await findNext(C1, OTHER, d4),
      d4,
    );

    // Across a run of days, the calendar's verdict is the booking's verdict.
    let disagree = 0;
    for (let i = 0; i < 4; i += 1) {
      const day = freshDay();
      for (let n = 0; n < i; n += 1) {
        must(await setNextDate(M1, (await newMatter({ categoryId: OTHER })).id, day), "fill");
      }
      const tile = await snapshot(M1, day, OTHER);
      const verdict = statusOf(
        await setNextDate(M1, (await newMatter({ categoryId: OTHER })).id, day),
      );
      const tileFull = tile.status === "full" || tile.status === "over_capacity";
      if (tileFull !== (verdict === "capacity_reached")) disagree += 1;
    }
    check("B-11: the calendar and the booking agree on every day tried", disagree, 0);
  }

  // ---------- B-12: a stale hearing edit is a conflict, not an overwrite ----------
  {
    const matter = await newMatter();
    const day = weekdayAhead(12);
    const eventId = must(await setNextDate(M1, matter.id, day), "next date")[0].event_id;
    const opened = must(
      await M1.from("docket_events").select("*").eq("id", eventId).single(),
      "M1 opens the dialog",
    );
    const clerkSave = await schedule(C1, matter.id, day, {
      p_event_id: eventId,
      p_stage_at_event: opened.stage_at_event,
      p_orders_made_at_event: "Bail granted $50,000; report weekly",
      p_notes: "C1: surety sworn",
      p_expected_updated_at: opened.updated_at,
    });
    check("B-12 control: the clerk's fresh edit is saved", statusOf(clerkSave), "created");
    const staleSave = await schedule(M1, matter.id, day, {
      p_event_id: eventId,
      p_scheduled_time: "09:30",
      p_stage_at_event: opened.stage_at_event,
      p_orders_made_at_event: opened.orders_made_at_event ?? undefined,
      p_notes: opened.notes ?? undefined,
      p_expected_updated_at: opened.updated_at,
    });
    check(
      "B-12: the magistrate's stale dialog is refused as a conflict",
      statusOf(staleSave),
      "conflict",
    );
    const kept = await eventRow(eventId);
    check(
      "B-12: the clerk's orders and notes survive",
      [kept.orders_made_at_event, kept.notes, kept.scheduled_time],
      ["Bail granted $50,000; report weekly", "C1: surety sworn", null],
    );

    const reopened = await eventRow(eventId);
    check(
      "B-12 control: saving again from the latest version goes through",
      statusOf(
        await schedule(M1, matter.id, day, {
          p_event_id: eventId,
          p_scheduled_time: "09:30",
          p_stage_at_event: reopened.stage_at_event,
          p_orders_made_at_event: reopened.orders_made_at_event,
          p_notes: reopened.notes,
          p_expected_updated_at: reopened.updated_at,
        }),
      ),
      "created",
    );
    check(
      "B-12 control: ... keeping the orders and adding the time",
      [(await eventRow(eventId)).orders_made_at_event, (await eventRow(eventId)).scheduled_time],
      ["Bail granted $50,000; report weekly", "09:30:00"],
    );
    const afterTime = await eventRow(eventId);
    check(
      "B-12 control: an adjournment from the latest version goes through",
      statusOf(
        await schedule(M1, matter.id, weekdayAhead(19), {
          p_event_id: eventId,
          p_stage_at_event: afterTime.stage_at_event,
          p_expected_updated_at: afterTime.updated_at,
        }),
      ),
      "created",
    );
    check(
      "B-12: a stale adjournment is a conflict too",
      statusOf(
        await schedule(M2, matter.id, weekdayAhead(26), {
          p_event_id: eventId,
          p_expected_updated_at: afterTime.updated_at,
        }),
      ),
      "conflict",
    );
    const other = await newMatter();
    const otherEvent = must(await setNextDate(M1, other.id, day), "other next date")[0].event_id;
    check(
      "B-12 control: the older call shape (no expected version) still edits",
      statusOf(
        await schedule(M2, other.id, day, {
          p_event_id: otherEvent,
          p_notes: "Older client",
        }),
      ),
      "created",
    );

    // The direct update path (hearing progress dialog) uses the same guard.
    const stale = await eventRow(otherEvent);
    must(
      await C1.from("docket_events")
        .update({ notes: "C1 again" })
        .eq("id", otherEvent)
        .select("id"),
      "clerk edits directly",
    );
    check(
      "B-12: a stale direct update matches no row",
      wrote(
        await M1.from("docket_events")
          .update({ notes: "stale" })
          .eq("id", otherEvent)
          .eq("updated_at", stale.updated_at)
          .select("id"),
      ),
      "no row",
    );
    const fresh = await eventRow(otherEvent);
    check(
      "B-12 control: a direct update from the latest version is written",
      wrote(
        await M1.from("docket_events")
          .update({ notes: "fresh" })
          .eq("id", otherEvent)
          .eq("updated_at", fresh.updated_at)
          .select("id"),
      ),
      "written",
    );
  }

  console.log(
    failures > 0 ? `\n${failures} failure(s).` : "\nAll docket scheduling integrity tests passed.",
  );
}

async function cleanup() {
  try {
    if (created.users.length > 0) {
      await admin.from("notifications").delete().in("user_id", created.users);
    }
    for (const courtId of created.courts) {
      const { data: leftover } = await admin
        .from("docket_matters")
        .select("id")
        .eq("court_id", courtId);
      const ids = leftover?.map((r) => r.id) ?? [];
      if (ids.length > 0) {
        await admin.from("docket_capacity_overrides").delete().in("docket_matter_id", ids);
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
