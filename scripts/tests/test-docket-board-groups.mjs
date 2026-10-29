/**
 * Desktop Docket board: one table per workflow, each with only its own
 * stage columns, so no file shows an N/A box under another workflow's stage.
 *
 *   npm run test:docket-board-groups
 */
import { readFileSync } from "node:fs";
import { boardWorkflowGroups } from "../../src/lib/docket-protocols.ts";
import { BOARD_COLUMNS } from "../../src/lib/docket-procedure.ts";

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

const rows = [
  { id: "p1", workflow_protocol: "civil_summons", category_name: "Protection order matter" },
  { id: "c1", workflow_protocol: "criminal_trial", category_name: "Criminal trial" },
  { id: "l1", workflow_protocol: "civil_summons", category_name: "Liability matter" },
  { id: "k1", workflow_protocol: "paper_committal", category_name: "Paper Committal" },
  { id: "c2", workflow_protocol: "criminal_trial", category_name: "Criminal trial" },
];
const groups = boardWorkflowGroups(rows);

check(
  "a mixed list gives one group per workflow, in board order",
  groups.map((g) => g.protocol),
  ["criminal_trial", "paper_committal", "civil_summons"],
);
check(
  "each group keeps its rows in list order",
  groups.map((g) => g.rows.map((r) => r.id)),
  [["c1", "c2"], ["k1"], ["p1", "l1"]],
);
check("every row lands in exactly one group", groups.flatMap((g) => g.rows).length, rows.length);

for (const group of groups) {
  check(
    `${group.protocol} table carries only its own stage columns (no N/A cells)`,
    group.columns.every((column) => column.protocols.includes(group.protocol)),
    true,
  );
  check(
    `${group.protocol} table carries every one of its stage columns`,
    group.columns.map((c) => c.key),
    BOARD_COLUMNS.filter((c) => c.protocols.includes(group.protocol)).map((c) => c.key),
  );
}

const civil = groups.find((g) => g.protocol === "civil_summons");
check(
  "civil table has no criminal stage columns",
  civil.columns.some((c) =>
    [
      "arraignment_status",
      "custody_status",
      "disclosure_status",
      "trial_status",
      "ruling_status",
      "judgment_status",
      "sentence_status",
      "appeal_status",
    ].includes(c.key),
  ),
  false,
);

check(
  "a single-workflow list is one group",
  boardWorkflowGroups([rows[0], rows[2]]).map((g) => g.protocol),
  ["civil_summons"],
);
check("an empty list has no groups", boardWorkflowGroups([]), []);
check(
  "a row without workflow_protocol falls back to its classification",
  boardWorkflowGroups([
    { id: "x", workflow_protocol: null, category_name: "Liability matter" },
  ]).map((g) => g.protocol),
  ["civil_summons"],
);
check(
  "a row with neither falls back to the criminal trial board",
  boardWorkflowGroups([{ id: "y" }]).map((g) => g.protocol),
  ["criminal_trial"],
);

// The board builds its tables from these groups, so it never has a column
// that does not apply to a row and never asks the cell for its N/A state.
const sheet = readFileSync(
  new URL("../../src/pages/docket/docket-stage-sheet.tsx", import.meta.url),
  "utf8",
);
check("the board groups its rows by workflow", sheet.includes("boardWorkflowGroups(rows)"), true);
check(
  "the board never renders a not-applicable stage cell",
  /columnApplies|applicable=/.test(sheet),
  false,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
