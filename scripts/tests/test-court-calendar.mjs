/**
 * Days the court does not sit (D1) — the pure rules.
 *
 * Weekends are a rule rather than 104 rows a year, recorded days are
 * data, and a sitting_exception beats both. Precedence is most-specific
 * first, so a court closure names itself over a national holiday.
 *
 * The date arithmetic matters as much as the rules: Guyana is UTC-4, and
 * this codebase has already been bitten once by a date shifting a day
 * when parsed as UTC (0018-A). Everything here goes through parseDateOnly.
 *
 *   npm run test:court-calendar
 */
import { isWeekend, nextSittingDay, sittingDayVerdict } from "../../src/lib/court-calendar.ts";

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

const COURT = "court-1";
const DISTRICT = "district-1";
const scope = { courtId: COURT, districtId: DISTRICT };
const elsewhere = { courtId: "court-2", districtId: "district-2" };

const national = (date, name) => ({
  holiday_date: date,
  name,
  kind: "public_holiday",
  court_id: null,
  district_id: null,
});
const districtClosure = (date, name) => ({
  holiday_date: date,
  name,
  kind: "court_closure",
  court_id: null,
  district_id: DISTRICT,
});
const courtException = (date, name) => ({
  holiday_date: date,
  name,
  kind: "sitting_exception",
  court_id: COURT,
  district_id: null,
});

// --- the weekend rule ----------------------------------------------------

check("Saturday is not a sitting day", isWeekend("2026-11-21"), true);
check("Sunday is not a sitting day", isWeekend("2026-11-22"), true);
check("Monday is", isWeekend("2026-11-23"), false);
check(
  "a weekend says which day it is, not a holiday name",
  sittingDayVerdict("2026-11-22", scope, []).reason,
  "a Sunday",
);

// --- recorded days --------------------------------------------------------

const rows = [
  national("2026-12-25", "Christmas Day"),
  districtClosure("2026-11-24", "District stocktaking"),
];
check("a national holiday applies everywhere", sittingDayVerdict("2026-12-25", elsewhere, rows), {
  sitting: false,
  reason: "Christmas Day",
});
check(
  "a district closure applies inside that district",
  sittingDayVerdict("2026-11-24", scope, rows),
  {
    sitting: false,
    reason: "District stocktaking",
  },
);
check("and not outside it", sittingDayVerdict("2026-11-24", elsewhere, rows).sitting, true);

// --- precedence -----------------------------------------------------------

check(
  "a sitting exception beats the weekend rule",
  sittingDayVerdict("2026-11-21", scope, [
    courtException("2026-11-21", "Special Saturday sitting"),
  ]),
  { sitting: true, reason: null },
);
check(
  "a sitting exception beats a national holiday on the same day",
  sittingDayVerdict("2026-12-25", scope, [
    national("2026-12-25", "Christmas Day"),
    courtException("2026-12-25", "Emergency remand court"),
  ]).sitting,
  true,
);
check(
  "but only at the court it names",
  sittingDayVerdict("2026-11-21", elsewhere, [
    courtException("2026-11-21", "Special Saturday sitting"),
  ]).sitting,
  false,
);
check(
  "the most specific reason is the one shown",
  sittingDayVerdict("2026-06-01", scope, [
    national("2026-06-01", "National day"),
    {
      holiday_date: "2026-06-01",
      name: "Roof repairs",
      kind: "court_closure",
      court_id: COURT,
      district_id: null,
    },
  ]).reason,
  "Roof repairs",
);

// --- an unrecorded year is not "every day sits" --------------------------

check(
  "an ordinary weekday with nothing recorded is a sitting day",
  sittingDayVerdict("2028-03-15", scope, []),
  { sitting: true, reason: null },
);
check(
  "but a 2028 weekend is still not, because the rule needs no data",
  sittingDayVerdict("2028-03-18", scope, []).sitting,
  false,
);

// --- next sitting day -----------------------------------------------------

check("Friday rolls to Monday", nextSittingDay("2026-11-20", scope, []), "2026-11-23");
check(
  "Christmas plus Boxing Day plus a weekend rolls to the Monday",
  nextSittingDay("2026-12-24", scope, [
    national("2026-12-25", "Christmas Day"),
    national("2026-12-26", "Boxing Day"),
  ]),
  "2026-12-28",
);
check(
  "it never returns the day it was given",
  nextSittingDay("2026-11-23", scope, []) !== "2026-11-23",
  true,
);
check(
  "an unbroken run of non-sitting days gives up rather than looping",
  nextSittingDay(
    "2026-01-01",
    scope,
    Array.from({ length: 40 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 0, 2 + i));
      return national(d.toISOString().slice(0, 10), "Closed");
    }),
    30,
  ),
  null,
);

// --- UTC-4 date arithmetic ------------------------------------------------

check(
  "a date near midnight does not shift a day (Guyana is UTC-4)",
  sittingDayVerdict("2026-11-23", scope, []).sitting,
  true,
);
check("month boundaries roll correctly", nextSittingDay("2026-10-30", scope, []), "2026-11-02");
check("year boundaries roll correctly", nextSittingDay("2026-12-31", scope, []), "2027-01-01");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
