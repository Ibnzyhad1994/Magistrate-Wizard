import {
  addDaysIso,
  dayOfLabel,
  daysOfWeek,
  weekOfLabel,
  weekStartSunday,
} from "../../src/lib/docket-week.ts";
import { parseDateOnly } from "../../src/lib/utils.ts";

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

check("Wed 2 Sep 2026 week starts Sunday 30 Aug", weekStartSunday("2026-09-02"), "2026-08-30");
check("Sunday is its own week start", weekStartSunday("2026-08-30"), "2026-08-30");
check("Saturday still belongs to that Sunday", weekStartSunday("2026-09-05"), "2026-08-30");
check("daysOfWeek is seven local ISO dates", daysOfWeek("2026-08-30"), [
  "2026-08-30",
  "2026-08-31",
  "2026-09-01",
  "2026-09-02",
  "2026-09-03",
  "2026-09-04",
  "2026-09-05",
]);
check("addDaysIso +7 is next Sunday", addDaysIso("2026-08-30", 7), "2026-09-06");
check("addDaysIso -7 is previous Sunday", addDaysIso("2026-08-30", -7), "2026-08-23");
check("weekOfLabel uses en-GB day month year", weekOfLabel("2026-08-30"), "Week of 30 Aug 2026");
check("dayOfLabel is weekday then en-GB date", dayOfLabel("2026-09-02"), "Wednesday, 2 Sept 2026");

const local = parseDateOnly("2026-09-02");
check("YYYY-MM-DD is local day 2, not UTC-shifted", local.getDate(), 2);
check("YYYY-MM-DD is local month September", local.getMonth(), 8);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
