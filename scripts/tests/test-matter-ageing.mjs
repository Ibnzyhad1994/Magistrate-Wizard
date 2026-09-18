/**
 * How long a file has been running, from appearances already on it (E1).
 *
 * docket_events has carried stage_at_event since 0024 and nothing ever
 * read it back across dates, so "this matter has been listed seven times
 * and is still at Disclosure" was unanswerable despite the data being
 * there.
 *
 * Everything here is arithmetic over records the caller can already see.
 * Nothing is predicted, and a file with no appearances reports nothing
 * rather than guessing.
 *
 *   npm run test:matter-ageing
 */
import { ageingSummary, matterAgeing } from "../../src/lib/matter-ageing.ts";

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

const ev = (date, stage, status = "completed") => ({
  scheduled_date: date,
  stage_at_event: stage,
  event_status: status,
});
const TODAY = "2026-09-18";
const label = (s) => s.charAt(0).toUpperCase() + s.slice(1);

check("a file with no appearances reports nothing", matterAgeing([], TODAY), {
  listedCount: 0,
  firstListed: null,
  lastListed: null,
  daysSinceFirstListed: null,
  sittingsAtCurrentStage: 0,
  currentStage: null,
});
check("and says nothing rather than guessing", ageingSummary(matterAgeing([], TODAY), label), null);

const run = [
  ev("2026-03-03", "arraignment"),
  ev("2026-04-14", "disclosure"),
  ev("2026-05-19", "disclosure"),
  ev("2026-07-21", "disclosure"),
];
const a = matterAgeing(run, TODAY);
check("every appearance is counted", a.listedCount, 4);
check("the first listing is found", a.firstListed, "2026-03-03");
check("the most recent listing is found", a.lastListed, "2026-07-21");
check("the age is in whole days", a.daysSinceFirstListed, 199);
check("the current stage is the most recent one", a.currentStage, "disclosure");
check("consecutive sittings at that stage are counted", a.sittingsAtCurrentStage, 3);
check(
  "the sentence reads as a record, not advice",
  ageingSummary(a, label),
  "Listed 4 times over 6 months, and still at Disclosure after 3 of them.",
);

// A run is only the CONSECUTIVE most recent appearances at one stage.
const movedOn = matterAgeing([...run, ev("2026-08-25", "trial")], TODAY);
check("moving on resets the run", movedOn.sittingsAtCurrentStage, 1);
check(
  "and the sentence drops the stalled clause",
  ageingSummary(movedOn, label),
  "Listed 5 times over 6 months.",
);

// Returning to an earlier stage does not merge with the older run.
const returned = matterAgeing(
  [...run, ev("2026-08-25", "trial"), ev("2026-09-01", "disclosure")],
  TODAY,
);
check("a later return to a stage starts a new run", returned.sittingsAtCurrentStage, 1);

// Appearances that never happened say nothing about a file's age.
const withCancelled = matterAgeing(
  [
    ev("2026-03-03", "arraignment"),
    ev("2026-04-14", "arraignment", "cancelled"),
    ev("2026-05-19", "arraignment", "entered_in_error"),
  ],
  TODAY,
);
check("cancelled appearances are not counted", withCancelled.listedCount, 1);
check("nor are ones entered in error", withCancelled.sittingsAtCurrentStage, 1);

// A future listing has not happened yet.
const withFuture = matterAgeing(
  [ev("2026-03-03", "arraignment"), ev("2026-12-01", "trial", "scheduled")],
  TODAY,
);
check("a future appearance is not counted as listed", withFuture.listedCount, 1);
check("and does not become the current stage", withFuture.currentStage, "arraignment");

// Singular and plural, and British spelling in the copy.
const once = matterAgeing([ev("2026-09-17", "arraignment")], TODAY);
check("one appearance reads as 'once'", ageingSummary(once, label), "Listed once over 1 day.");

// A stage recorded as null must not manufacture a run.
const noStage = matterAgeing([ev("2026-03-03", null), ev("2026-04-14", null)], TODAY);
check("appearances with no stage recorded produce no run", noStage.sittingsAtCurrentStage, 0);
check("and no stalled clause", ageingSummary(noStage, label), "Listed 2 times over 6 months.");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
