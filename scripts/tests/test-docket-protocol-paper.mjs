/**
 * Paper Committal protocol walk — keep in lockstep with
 * docket_matters_set_workflow_protocol() (0140).
 *
 *   npm run test:docket-protocol-paper
 */
import {
  currentStageForProtocol,
  EMPTY_PROTOCOL_SNAPSHOT,
  protocolFromCategoryName,
} from "../../src/lib/docket-protocols.ts";
import { protocolColumns, visibleBoardColumns } from "../../src/lib/docket-procedure.ts";

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
  "Paper Committal category maps to paper_committal protocol",
  protocolFromCategoryName("Paper Committal"),
  "paper_committal",
);

const blank = { ...EMPTY_PROTOCOL_SNAPSHOT };
check(
  "new paper matter is at arraignment",
  currentStageForProtocol(blank, "paper_committal"),
  "arraignment",
);

const afterDisclosure = {
  ...blank,
  arraignment_status: "done",
  custody_status: "on_bail",
  disclosure_status: "full",
};
check(
  "full disclosure with paper committal not started stays at paper_committal",
  currentStageForProtocol(afterDisclosure, "paper_committal"),
  "paper_committal",
);
check(
  "commenced paper committal still at paper_committal",
  currentStageForProtocol({ ...afterDisclosure, paper_committal_status: "commenced" }, "paper_committal"),
  "paper_committal",
);
check(
  "partial paper committal still at paper_committal",
  currentStageForProtocol({ ...afterDisclosure, paper_committal_status: "partial" }, "paper_committal"),
  "paper_committal",
);

const afterPaper = {
  ...afterDisclosure,
  paper_committal_status: "completed",
};
check(
  "completed paper committal moves to ruling",
  currentStageForProtocol(afterPaper, "paper_committal"),
  "ruling",
);

const afterJudgment = {
  ...afterPaper,
  ruling_status: "delivered",
  judgment_status: "delivered",
  sentence_status: "not_started",
};
check(
  "paper protocol skips sentence and lands on appeal",
  currentStageForProtocol(afterJudgment, "paper_committal"),
  "appeal",
);

const paperKeys = protocolColumns("paper_committal").map((c) => c.key);
check("paper board has no sentence column", paperKeys.includes("sentence_status"), false);
check("paper board has no criminal trial column", paperKeys.includes("trial_status"), false);
check("paper board has paper_committal_status", paperKeys.includes("paper_committal_status"), true);

const mixed = visibleBoardColumns([
  { workflow_protocol: "criminal_trial" },
  { workflow_protocol: "paper_committal" },
]);
check(
  "mixed criminal+paper union includes Paper Committal and Sentence",
  mixed.map((c) => c.key).includes("paper_committal_status") &&
    mixed.map((c) => c.key).includes("sentence_status"),
  true,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
