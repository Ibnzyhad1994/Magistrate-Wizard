/**
 * End-of-day close-out (D3).
 *
 * Classifies the rows the board ALREADY fetched for a date -- not a
 * second query with its own membership rule, which would drift from the
 * list it claims to summarise (the class of bug 0147 to 0148 fixed).
 *
 * The distinction that matters: this reads the APPEARANCE outcome, from
 * docket_events, never docket_matters.outcome_status. One is what
 * happened at a sitting; the other is how the whole matter ended.
 *
 *   npm run test:docket-closeout
 */
import {
  classifyCloseout,
  closeoutEntries,
  overnightWarning,
  reportWarning,
  summariseCloseout,
} from "../../src/lib/docket-closeout.ts";

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

const DAY = "2026-09-18";
const row = (over) => ({
  id: "m1",
  case_number: "GEO-2026-001",
  matter_title: "Police v. Demo",
  appearance_status: "scheduled",
  appearance_outcome: null,
  next_appearance: null,
  can_edit: true,
  ...over,
});

check(
  "scheduled with no outcome and no next date needs both",
  classifyCloseout(row(), DAY),
  "both",
);
check(
  "an outcome recorded, but nothing scheduled after today",
  classifyCloseout(row({ appearance_outcome: "Adjourned" }), DAY),
  "no_next_date",
);
check(
  "a next date set, but the sitting has no outcome",
  classifyCloseout(row({ next_appearance: "2026-10-01" }), DAY),
  "no_outcome",
);
check(
  "both recorded is ready",
  classifyCloseout(row({ appearance_outcome: "Adjourned", next_appearance: "2026-10-01" }), DAY),
  "ready",
);
check(
  "an outcome of whitespace is not an outcome",
  classifyCloseout(row({ appearance_outcome: "   ", next_appearance: "2026-10-01" }), DAY),
  "no_outcome",
);
check(
  "a cancelled appearance needs no outcome",
  classifyCloseout(row({ appearance_status: "cancelled", next_appearance: "2026-10-01" }), DAY),
  "ready",
);
check(
  "an appearance already completed needs no outcome",
  classifyCloseout(row({ appearance_status: "completed", next_appearance: "2026-10-01" }), DAY),
  "ready",
);
check(
  "a next date ON the day being closed is not 'what happens next'",
  classifyCloseout(row({ appearance_outcome: "Part-heard", next_appearance: DAY }), DAY),
  "no_next_date",
);
check(
  "a date before the day being closed does not count either",
  classifyCloseout(row({ appearance_outcome: "Part-heard", next_appearance: "2026-09-01" }), DAY),
  "no_next_date",
);

// --- summary and the overnight line --------------------------------------

const entries = closeoutEntries(
  [
    row({ id: "a" }),
    row({ id: "b", appearance_outcome: "Adjourned" }),
    row({ id: "c", appearance_outcome: "Adjourned", next_appearance: "2026-10-01" }),
    row({ id: "d", next_appearance: "2026-10-01" }),
  ],
  DAY,
);
const summary = summariseCloseout(entries);
check("every listed file is counted", summary.total, 4);
check("three of them need something", summary.needingAttention, 3);
check("two are missing an outcome", summary.missingOutcome, 2);
check("two are missing a next date", summary.missingNextDate, 2);

check(
  "the overnight line says what the 6am job will do",
  overnightWarning(summary),
  "At 6am tomorrow, 2 appearances still marked scheduled will be recorded as past with no outcome.",
);
check(
  "it is singular for one",
  overnightWarning({ ...summary, missingOutcome: 1 }),
  "At 6am tomorrow, 1 appearance still marked scheduled will be recorded as past with no outcome.",
);
check(
  "and silent when nothing is missing",
  overnightWarning({ ...summary, missingOutcome: 0 }),
  null,
);
check(
  "the report line matches what the PDF would print",
  reportWarning(summary),
  "2 matters would print as \u201cNot recorded\u201d on the daily report.",
);
check(
  "and is silent when there is nothing to print",
  reportWarning({ ...summary, missingOutcome: 0 }),
  null,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
