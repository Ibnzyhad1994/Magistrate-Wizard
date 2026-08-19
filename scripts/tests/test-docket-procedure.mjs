import {
  currentStage,
  filtersToRpcArgs,
  hasActiveProcedureFilters,
  activeProcedureFilterCount,
  matchesProcedureFilters,
  procedureCellLabel,
  procedureCellMode,
  procedureCellTone,
  toggleFilterValue,
  EMPTY_PROCEDURE_FILTERS,
  appearanceHintForColumn,
} from "../../src/lib/docket-procedure.ts";

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

const blank = {
  arraignment_status: "not_started",
  custody_status: "unset",
  disclosure_status: "none",
  trial_status: "not_commenced",
  ruling_status: "not_started",
  judgment_status: "not_started",
  sentence_status: "not_started",
  appeal_status: "not_started",
};

check("new matter is at arraignment", currentStage(blank), "arraignment");

check(
  "after arraignment, custody is next",
  currentStage({ ...blank, arraignment_status: "done" }),
  "custody",
);

check(
  "on remand still at disclosure until papers are full",
  currentStage({
    ...blank,
    arraignment_status: "done",
    custody_status: "remanded",
    disclosure_status: "partial",
  }),
  "disclosure",
);

check(
  "full disclosure with trial not started is at trial",
  currentStage({
    ...blank,
    arraignment_status: "done",
    custody_status: "on_bail",
    disclosure_status: "full",
    trial_status: "not_commenced",
  }),
  "trial",
);

check(
  "part-heard trial stays at trial",
  currentStage({
    ...blank,
    arraignment_status: "done",
    custody_status: "on_bail",
    disclosure_status: "full",
    trial_status: "partial",
  }),
  "trial",
);

const afterSentence = {
  arraignment_status: "done",
  custody_status: "on_bail",
  disclosure_status: "full",
  trial_status: "completed",
  ruling_status: "delivered",
  judgment_status: "delivered",
  sentence_status: "passed",
  appeal_status: "not_started",
};

check("after sentence, current stage is appeal", currentStage(afterSentence), "appeal");
check(
  "disposed appeal still reports appeal (terminal board column)",
  currentStage({ ...afterSentence, appeal_status: "disposed" }),
  "appeal",
);

check("empty filters are inactive", hasActiveProcedureFilters(EMPTY_PROCEDURE_FILTERS), false);
check("empty filters count is 0", activeProcedureFilterCount(EMPTY_PROCEDURE_FILTERS), 0);
check(
  "stage chip counts as active",
  hasActiveProcedureFilters({ ...EMPTY_PROCEDURE_FILTERS, stages: ["trial"] }),
  true,
);
check(
  "two groups add to filter count",
  activeProcedureFilterCount({
    ...EMPTY_PROCEDURE_FILTERS,
    stages: ["trial"],
    custody: ["remanded"],
  }),
  2,
);

const row = {
  ...afterSentence,
  trial_status: "partial",
  judgment_status: "not_started",
  sentence_status: "not_started",
  next_appearance: "2026-08-20",
};

check(
  "AND across groups: trial chip matches part-heard",
  matchesProcedureFilters(row, { ...EMPTY_PROCEDURE_FILTERS, trial: ["partial"] }, "2026-08-19"),
  true,
);

check(
  "AND across groups: remand chip excludes on-bail",
  matchesProcedureFilters(row, { ...EMPTY_PROCEDURE_FILTERS, custody: ["remanded"] }, "2026-08-19"),
  false,
);

check(
  "OR within next-date: upcoming matches later date",
  matchesProcedureFilters(row, { ...EMPTY_PROCEDURE_FILTERS, nextDate: ["today", "upcoming"] }, "2026-08-19"),
  true,
);

check(
  "no_date excludes a listed matter",
  matchesProcedureFilters(row, { ...EMPTY_PROCEDURE_FILTERS, nextDate: ["no_date"] }, "2026-08-19"),
  false,
);

check("toggle adds then removes", toggleFilterValue(["trial"], "trial"), []);
check("toggle adds missing", toggleFilterValue(["trial"], "disclosure"), ["trial", "disclosure"]);

check("empty arraignment shows em dash", procedureCellLabel("not_started"), "—");
check("disclosure none is labelled", procedureCellLabel("none"), "No disclosure");
check("remand tone is distinct", procedureCellTone("custody_status", "remanded"), "remand");
check("done tone", procedureCellTone("arraignment_status", "done"), "done");
check("view-only share is read mode", procedureCellMode(false), "read");
check("edit share is edit mode", procedureCellMode(true), "edit");

const hint = appearanceHintForColumn("disclosure_status", "partial");
check("disclosure hint uses Disclosure event type", hint.event_type, "Disclosure");

const rpc = filtersToRpcArgs({ ...EMPTY_PROCEDURE_FILTERS, stages: ["trial"], nextDate: ["today"] });
check("empty filter groups omit RPC args", rpc.p_custody, undefined);
check("selected stages pass through", rpc.p_procedure_stages, ["trial"]);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
