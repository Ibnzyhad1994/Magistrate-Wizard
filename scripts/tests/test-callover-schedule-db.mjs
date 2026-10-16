// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * Callover matters reach the day's schedule, on a real database.
 *
 * Replays what a magistrate reported: matters entered on a callover were
 * not listed when they opened that day on the Calendar or the Docket. As
 * the seeded magistrate, through the same RLS the app runs under:
 *
 *   1. a matter entered as a callover matter is on that day's Calendar
 *      query, that day's Docket list and that day's callover sheet;
 *   2. Mark completed removes nothing from any of them;
 *   3. a sheet row typed in the old way (no appearance) is put back on the
 *      schedule, and a row already called and adjourned is filed as a
 *      completed appearance without disturbing its later hearing.
 *
 * Every row it makes carries the fixture prefix and is removed afterwards.
 *
 *   npm run db:start && npm run test:callover-schedule-db
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";
import {
  calloverAppearance,
  calloverMatterKey,
  calloverMatterKeys,
  listCalloverMatter,
  scheduleCalloverAppearance,
} from "../../src/lib/callover-schedule.ts";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-callover-schedule-db");
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
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

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const magistrate = createClient(URL, ANON, { auth: { persistSession: false } });
const MARK = `CO-FIX-${Date.now() % 1_000_000}`;
// A date with no other fixtures, so a seeded hearing can never collide.
const DAY = "2031-03-11";
const LATER = "2031-03-25";

const matterIds = [];
const calloverIds = new Set();

async function cleanup() {
  if (matterIds.length > 0) {
    await admin.from("docket_callover_items").delete().in("docket_matter_id", matterIds);
    await admin.from("docket_capacity_overrides").delete().in("docket_matter_id", matterIds);
    await admin.from("docket_events").delete().in("docket_matter_id", matterIds);
    await admin.from("docket_matters").delete().in("id", matterIds);
  }
  if (calloverIds.size > 0)
    await admin
      .from("docket_callovers")
      .delete()
      .in("id", [...calloverIds]);
}

async function onDay(date) {
  // The Calendar's query (use-calendar-events.ts) and the Docket day list's
  // (list_docket_matters with p_exact_date), exactly as the app sends them.
  const events = must(
    await magistrate
      .from("docket_events")
      .select("docket_matter_id, event_status, event_type, outcome_at_event")
      .gte("scheduled_date", date)
      .lte("scheduled_date", date),
    "calendar",
  );
  const board = must(
    await magistrate.rpc("list_docket_matters", { p_query: "", p_limit: 500, p_exact_date: date }),
    "day list",
  );
  return { events, boardIds: new Set(board.map((row) => row.id)) };
}

async function newMatter(seat, category, n) {
  const matter = must(
    await magistrate
      .from("docket_matters")
      .insert({
        court_id: seat.court_id,
        district_id: seat.courts.district_id,
        case_number: `${MARK}-${n}/2019`,
        matter_title: `Police v. Fictional Accused ${n}`,
        status: "active",
        category_id: category.id,
        brought_forward_from: "Fictional predecessor file",
      })
      .select()
      .single(),
    "create matter",
  );
  matterIds.push(matter.id);
  return matter;
}

try {
  const { user } = must(
    await magistrate.auth.signInWithPassword({
      email: "magistrate@magistrate-wizard.local",
      password: "password123",
    }),
    "sign in (is the local seed loaded?)",
  );
  const seat = must(
    await magistrate
      .from("magistrate_courts")
      .select("court_id, courts(district_id)")
      .eq("profile_id", user.id)
      .is("ended_at", null)
      .limit(1)
      .single(),
    "seat",
  );
  const category = must(
    await magistrate.from("docket_matter_categories").select("id").limit(1).single(),
    "category",
  );

  // 1. A matter entered as a callover matter.
  const fresh = await newMatter(seat, category, 1);
  const listed = await listCalloverMatter(magistrate, {
    matterId: fresh.id,
    courtId: seat.court_id,
    date: DAY,
    categoryId: category.id,
    acknowledgeOverride: true,
  });
  check("the callover matter is listed", listed.status, "created");
  calloverIds.add(listed.calloverId);

  let day = await onDay(DAY);
  check(
    "it is on that day's Calendar",
    day.events.some((e) => e.docket_matter_id === fresh.id),
    true,
  );
  check("it is on that day's Docket list", day.boardIds.has(fresh.id), true);
  const sheet = must(
    await magistrate
      .from("docket_callovers")
      .select("callover_date, status, docket_callover_items(docket_matter_id)")
      .eq("id", listed.calloverId)
      .single(),
    "sheet",
  );
  check(
    "it is on that day's callover sheet, a new draft",
    [sheet.callover_date, sheet.status],
    [DAY, "draft"],
  );
  check(
    "and the schedule can mark it as a callover matter",
    calloverMatterKeys([sheet]).has(calloverMatterKey(DAY, fresh.id)),
    true,
  );

  // 2. Mark completed.
  must(
    await magistrate
      .from("docket_callovers")
      .update({ status: "completed" })
      .eq("id", listed.calloverId)
      .select()
      .single(),
    "complete",
  );
  day = await onDay(DAY);
  check(
    "after Mark completed it is still on the Calendar",
    day.events.some((e) => e.docket_matter_id === fresh.id),
    true,
  );
  check("and still on the Docket list", day.boardIds.has(fresh.id), true);
  const items = must(
    await magistrate
      .from("docket_callover_items")
      .select("id")
      .eq("callover_id", listed.calloverId),
    "items after complete",
  );
  check("and still on the sheet", items.length, 1);

  // 3. Rows typed in the old way: on the sheet, never on the schedule.
  const oldSheet = must(
    await magistrate
      .from("docket_callovers")
      .insert({ court_id: seat.court_id, callover_date: DAY, title: `${MARK} old sheet` })
      .select("id")
      .single(),
    "old sheet",
  );
  calloverIds.add(oldSheet.id);
  const uncalled = await newMatter(seat, category, 2);
  const adjourned = await newMatter(seat, category, 3);
  for (const [n, matter] of [uncalled, adjourned].entries()) {
    must(
      await magistrate
        .from("docket_callover_items")
        .insert({ callover_id: oldSheet.id, docket_matter_id: matter.id, sort_order: n + 1 })
        .select()
        .single(),
      "old item",
    );
  }
  const calledAt = new Date().toISOString();
  must(
    await magistrate
      .from("docket_callover_items")
      .update({ outcome: "Adjourned", called_at: calledAt, next_date: LATER })
      .eq("callover_id", oldSheet.id)
      .eq("docket_matter_id", adjourned.id)
      .select()
      .single(),
    "adjourn row",
  );
  must(
    await magistrate.rpc("set_docket_matter_next_date", {
      p_docket_matter_id: adjourned.id,
      p_scheduled_date: LATER,
      p_category_id: category.id,
      p_acknowledge_override: true,
    }),
    "next date",
  );

  day = await onDay(DAY);
  check(
    "reproduced: rows typed in the old way are missing from the day",
    [uncalled.id, adjourned.id].map((id) => day.boardIds.has(id)),
    [false, false],
  );

  for (const [matter, row] of [
    [uncalled, { called_at: null, outcome: null }],
    [adjourned, { called_at: calledAt, outcome: "Adjourned" }],
  ]) {
    const result = await scheduleCalloverAppearance(magistrate, {
      matterId: matter.id,
      date: DAY,
      categoryId: category.id,
      acknowledgeOverride: true,
      ...calloverAppearance(row),
    });
    check(`${matter.case_number} is put on the schedule`, result.status, "created");
  }

  day = await onDay(DAY);
  check(
    "both are now on the Docket list",
    [uncalled.id, adjourned.id].map((id) => day.boardIds.has(id)),
    [true, true],
  );
  const filed = day.events.find((e) => e.docket_matter_id === adjourned.id);
  check("the called row is a completed Callover appearance with its outcome", filed, {
    docket_matter_id: adjourned.id,
    event_status: "completed",
    event_type: "Callover",
    outcome_at_event: "Adjourned",
  });
  const later = must(
    await magistrate
      .from("docket_events")
      .select("event_status")
      .eq("docket_matter_id", adjourned.id)
      .eq("scheduled_date", LATER),
    "later hearing",
  );
  check(
    "its later hearing is untouched",
    later.map((e) => e.event_status),
    ["scheduled"],
  );
} finally {
  await cleanup();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nCallover matters reach the day's schedule.");
