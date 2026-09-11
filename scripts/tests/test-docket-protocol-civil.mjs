/**
 * Civil summons protocol walk — Protection / Maintenance / Liability.
 *
 *   npm run test:docket-protocol-civil
 */
import {
  currentStageForProtocol,
  EMPTY_PROTOCOL_SNAPSHOT,
  mergeStageAdjournment,
  outcomeBoardPatch,
  protocolFromCategoryName,
} from "../../src/lib/docket-protocols.ts";
import { protocolColumns } from "../../src/lib/docket-procedure.ts";
import { outcomeOptionsForProtocol } from "../../src/lib/docket-outcome.ts";

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

check(
  "Protection order matter maps to civil_summons",
  protocolFromCategoryName("Protection order matter"),
  "civil_summons",
);
check(
  "Maintenance matter maps to civil_summons",
  protocolFromCategoryName("Maintenance matter"),
  "civil_summons",
);
check(
  "Liability matter maps to civil_summons",
  protocolFromCategoryName("Liability matter"),
  "civil_summons",
);
check(
  "Other keeps the Criminal Trial board",
  protocolFromCategoryName("Other"),
  "criminal_trial",
);

const blank = { ...EMPTY_PROTOCOL_SNAPSHOT };
check(
  "new civil matter is at information_sworn",
  currentStageForProtocol(blank, "civil_summons"),
  "information_sworn",
);

const sworn = { ...blank, information_sworn_status: "done" };
check(
  "after information sworn, summons served is next",
  currentStageForProtocol(sworn, "civil_summons"),
  "summons_served",
);
check(
  "summons served No keeps the file at summons_served",
  currentStageForProtocol({ ...sworn, summons_served: "no" }, "civil_summons"),
  "summons_served",
);

const served = { ...sworn, summons_served: "yes", returns_of_summons: "yes" };
check(
  "returns recorded Yes, trial not yet answered stays at civil_trial",
  currentStageForProtocol(served, "civil_summons"),
  "civil_trial",
);
check(
  "trial Yes advances to decision",
  currentStageForProtocol({ ...served, civil_trial_held: "yes" }, "civil_summons"),
  "decision",
);
check(
  "trial No also advances to decision",
  currentStageForProtocol({ ...served, civil_trial_held: "no" }, "civil_summons"),
  "decision",
);

const civilKeys = protocolColumns("civil_summons").map((c) => c.key);
check("civil board has no arraignment", civilKeys.includes("arraignment_status"), false);
check("civil board has no custody", civilKeys.includes("custody_status"), false);
check("civil board has no sentence", civilKeys.includes("sentence_status"), false);
check("civil board has information sworn", civilKeys.includes("information_sworn_status"), true);
check("civil board has a Decision column", civilKeys.includes("decision"), true);

const adjourned = mergeStageAdjournment({}, "summons_served", true, "awaiting documentation");
check("adjournment is a state on the stage, not a new stage key", Object.keys(adjourned), [
  "summons_served",
]);
check("adjournment reason is stored", adjourned.summons_served.reason, "awaiting documentation");
check(
  "clearing adjournment removes the stage entry",
  mergeStageAdjournment(adjourned, "summons_served", false, ""),
  {},
);

check(
  "civil Outcome Adjourned does not write outcome_status",
  outcomeBoardPatch("adjourned"),
  { outcome_status: null, outcome_adjourned: true },
);
check(
  "civil Outcome Completed still uses outcome_status",
  outcomeBoardPatch("completed"),
  { outcome_status: "completed", outcome_adjourned: false },
);

const civilOutcomes = outcomeOptionsForProtocol("civil_summons").map((o) => o.value);
check("civil outcome options are Completed and Adjourned", civilOutcomes, ["completed", "adjourned"]);
// Was "Completed only". That assertion encoded a real gap rather than a
// rule: a paper-committal board carries an Arraignment column that accepts
// "Not Found, To Be Summoned", so the exact situation the Outcome column was
// added for (0131) was reachable on this board with no disposition to record
// against it. The 0131 CHECK constraint always permitted `dismissed` for
// every protocol — the restriction was UI-only. Civil stays as it was: no
// Arraignment column, so not_found is unreachable there and the same
// argument does not apply. The cross-check that ties these together lives in
// test-docket-outcome.mjs.
check(
  "paper outcome options are Completed and Dismissed",
  outcomeOptionsForProtocol("paper_committal").map((o) => o.value),
  ["completed", "dismissed"],
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
