import {
  OUTCOME_STATUSES,
  OUTCOME_VALUE_LABELS,
  isOutcomeStatus,
  outcomeLabel,
  outcomeTone,
} from "../../src/lib/docket-outcome.ts";
import {
  ARRAIGNMENT_STATUSES,
  PROCEDURE_VALUE_LABELS,
  currentStage,
} from "../../src/lib/docket-procedure.ts";
import { DOCKET_MATTER_STATUSES } from "../../src/lib/validations/docket.ts";

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

// --- vocabulary matches what the 0131 CHECK constraints actually allow ---

check("outcome_status has exactly two values, matching the live CHECK constraint",
  [...OUTCOME_STATUSES], ["dismissed", "completed"]);

check("arraignment_status gained 'not_found' alongside the existing two, matching the live CHECK constraint",
  [...ARRAIGNMENT_STATUSES], ["not_started", "done", "not_found"]);

check("docket_matter_status gained 'dismissed', matching the live enum",
  [...DOCKET_MATTER_STATUSES], ["active", "stayed", "completed", "archived", "dismissed"]);

check("'not_found' has a board label", PROCEDURE_VALUE_LABELS.not_found, "Not Found, To Be Summoned");
check("every outcome value has a label", OUTCOME_STATUSES.every((v) => typeof OUTCOME_VALUE_LABELS[v] === "string"), true);

// --- isOutcomeStatus ---

check("a known outcome is recognised", isOutcomeStatus("dismissed"), true);
check("the other known outcome is recognised", isOutcomeStatus("completed"), true);
check("an unknown string is rejected", isOutcomeStatus("archived"), false);
check("null is rejected", isOutcomeStatus(null), false);
check("undefined is rejected", isOutcomeStatus(undefined), false);
check("a non-string is rejected", isOutcomeStatus(42), false);

// --- tone: this is the whole point of the feature (red vs blue) ---

check("dismissed tones red", outcomeTone("dismissed"), "dismissed");
check("completed tones blue", outcomeTone("completed"), "complete");
check("no outcome tones muted", outcomeTone(null), "muted");
check("an empty string tones muted", outcomeTone(""), "muted");
check("an unrecognised value tones muted, not a false positive", outcomeTone("something_else"), "muted");

// --- label ---

check("dismissed label", outcomeLabel("dismissed"), "Dismissed");
check("completed label", outcomeLabel("completed"), "Completed");
check("no outcome reads as not recorded", outcomeLabel(null), "Not recorded");
check("civil adjourned label", outcomeLabel(null, true), "Adjourned");
check("civil adjourned tones progress-like", outcomeTone(null, true), "adjourned");

// --- the core promise: 'not_found' keeps a matter at the Arraignment
// stage, exactly like 'not_started' does, distinguishing "never
// attempted" from "attempted and failed" without either one silently
// advancing the board. ---

const base = {
  custody_status: "unset",
  disclosure_status: "none",
  trial_status: "not_commenced",
  ruling_status: "not_started",
  judgment_status: "not_started",
  sentence_status: "not_started",
  appeal_status: "not_started",
};

check("arraignment_status='not_found' stays at the arraignment stage",
  currentStage({ ...base, arraignment_status: "not_found" }), "arraignment");
check("arraignment_status='not_started' also stays at arraignment (unchanged behaviour)",
  currentStage({ ...base, arraignment_status: "not_started" }), "arraignment");
check("arraignment_status='done' still advances past arraignment",
  currentStage({ ...base, arraignment_status: "done" }), "custody");

if (failures > 0) {
  console.log(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll docket-outcome tests passed.");
