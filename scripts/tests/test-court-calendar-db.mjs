// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * The court calendar rule exists twice: in SQL as
 * public.is_court_sitting_day() and in TypeScript as sittingDayVerdict().
 * Two implementations of one rule is exactly where drift happens, and the
 * drift would be silent -- a warning that quietly stops appearing.
 *
 * So this drives BOTH against one shared fixture set and asserts they
 * agree on every case, rather than testing each in isolation.
 *
 * Also checks the RLS shape: reference data every authenticated user can
 * read and only an administrator can change.
 *
 *   npm run db:start && npm run test:court-calendar-db
 */
import { createClient } from "@supabase/supabase-js";
import { sittingDayVerdict } from "../../src/lib/court-calendar.ts";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
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

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const user = createClient(URL, ANON, { auth: { persistSession: false } });
const MARK = "fixture-0159";

const cleanup = async () => {
  await admin.from("court_non_sitting_days").delete().like("name", `${MARK}%`);
};

try {
  await cleanup();

  const { data: courts } = await admin
    .from("courts")
    .select("id, district_id")
    .not("district_id", "is", null)
    .limit(2);
  if (!courts || courts.length < 2) throw new Error("need two seeded courts with districts");
  const [here, there] = courts;

  await admin.from("court_non_sitting_days").insert([
    { holiday_date: "2026-07-06", name: `${MARK} national`, kind: "public_holiday" },
    {
      holiday_date: "2026-07-07",
      name: `${MARK} district`,
      kind: "court_closure",
      district_id: here.district_id,
    },
    {
      holiday_date: "2026-07-11",
      name: `${MARK} special sitting`,
      kind: "sitting_exception",
      court_id: here.id,
    },
    {
      holiday_date: "2026-07-06",
      name: `${MARK} override`,
      kind: "sitting_exception",
      court_id: there.id,
    },
  ]);

  const { data: rows, error: readError } = await user
    .from("court_non_sitting_days")
    .select("holiday_date, name, kind, court_id, district_id");
  check("an anonymous client can read reference data", readError, null);

  // Every case, run through BOTH implementations.
  const cases = [
    ["2026-07-06", here, "a national holiday"],
    ["2026-07-06", there, "a national holiday overridden at one court"],
    ["2026-07-07", here, "a district closure inside the district"],
    ["2026-07-07", there, "the same day outside the district"],
    ["2026-07-11", here, "a Saturday with a sitting exception"],
    ["2026-07-11", there, "the same Saturday elsewhere"],
    ["2026-07-12", here, "an ordinary Sunday"],
    ["2026-07-08", here, "an ordinary Wednesday"],
    ["2026-12-25", here, "seeded Christmas Day"],
  ];

  for (const [date, court, label] of cases) {
    const { data: sqlAnswer, error } = await user.rpc("is_court_sitting_day", {
      p_date: date,
      p_court_id: court.id,
      p_district_id: court.district_id,
    });
    if (error) throw new Error(`is_court_sitting_day(${date}): ${error.message}`);
    const tsAnswer = sittingDayVerdict(
      date,
      { courtId: court.id, districtId: court.district_id },
      rows ?? [],
    ).sitting;
    check(`SQL and TypeScript agree on ${label} (${date})`, sqlAnswer, tsAnswer);
  }

  // RLS: reference data is admin-writable only.
  const { error: anonInsert } = await user
    .from("court_non_sitting_days")
    .insert({ holiday_date: "2026-07-20", name: `${MARK} anon`, kind: "public_holiday" });
  check("an ordinary client cannot add a non-sitting day", Boolean(anonInsert), true);

  const { error: magInsert } = await (async () => {
    const asMagistrate = createClient(URL, ANON, { auth: { persistSession: false } });
    await asMagistrate.auth.signInWithPassword({
      email: "magistrate@magistrate-wizard.local",
      password: "password123",
    });
    const result = await asMagistrate
      .from("court_non_sitting_days")
      .insert({ holiday_date: "2026-07-21", name: `${MARK} mag`, kind: "public_holiday" });
    await asMagistrate.auth.signOut();
    return result;
  })();
  check("a magistrate cannot either — this is administrator data", Boolean(magInsert), true);
} finally {
  await cleanup();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
