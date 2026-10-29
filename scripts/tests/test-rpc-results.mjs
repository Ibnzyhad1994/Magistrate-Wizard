/**
 * RPC results are checked at the data-access boundary (src/lib/rpc-results.ts).
 *
 *   BE-23  a well-formed result passes untouched (the same array comes
 *          back); a missing column, a wrong type, a null where the SQL
 *          never returns one, an unknown enum value or a malformed date is
 *          a typed RpcResultError naming the RPC and the column; in a
 *          production build the same mismatch is reported and the rows are
 *          passed through unchanged, so the screen behaves as before.
 *
 *   npm run test:rpc-results
 */
import { RpcResultError, checkRpc, checkRpcResult, searchIdRowsSchema } from "@/lib/rpc-results";

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

/** The RpcResultError a call throws, or null. */
function thrown(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

const ID = "6f1c2a0e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const boardRow = () => ({
  id: ID,
  case_number: "1234/2026",
  matter_title: "Police v Example",
  status: "active",
  charge_or_issue: null,
  cover_image_path: null,
  court_id: ID,
  district_id: ID,
  created_at: "2026-10-28T09:00:00+00:00",
  updated_at: "2026-10-28T09:00:00+00:00",
  court_name: "Georgetown Court 1",
  arraignment_status: "pending",
  custody_status: "na",
  disclosure_status: "na",
  trial_status: "na",
  paper_committal_status: "na",
  ruling_status: "na",
  judgment_status: "na",
  sentence_status: "na",
  appeal_status: "na",
  information_sworn_status: "na",
  summons_served: "na",
  returns_of_summons: "na",
  civil_trial_held: "na",
  decision_granted: null,
  decision_amount: null,
  stage_adjournments: {},
  outcome_status: null,
  outcome_adjourned: false,
  workflow_protocol: "criminal_trial",
  procedure_stage: "arraignment",
  next_appearance: "2026-11-02",
  can_edit: true,
  has_ruling_document: false,
  has_judgment_document: false,
  appearance_status: null,
  appearance_stage: null,
  appearance_outcome: null,
  category_id: null,
  category_name: null,
  category_other: null,
  rank: 0,
  headline: null,
});

// --- well-formed results pass untouched ------------------------------------

const rows = [boardRow(), { ...boardRow(), next_appearance: null, rank: 0.5 }];
check(
  "a well-formed board result returns the same array",
  checkRpc("list_docket_matters", rows) === rows,
  true,
);
check("an empty result passes", checkRpc("list_docket_matters", []).length, 0);
check(
  "extra columns from a newer database are tolerated",
  checkRpc("list_docket_matters", [{ ...boardRow(), added_later: 1 }]).length,
  1,
);
check(
  "no next date is a valid suggestion",
  checkRpc("find_next_available_docket_date", null),
  null,
);
check(
  "a YYYY-MM-DD suggestion passes",
  checkRpc("find_next_available_docket_date", "2026-11-02"),
  "2026-11-02",
);

// --- malformed results are a typed error ------------------------------------

{
  const { rank: _rank, ...withoutRank } = boardRow();
  const error = thrown(() => checkRpc("list_docket_matters", [withoutRank]));
  check("a missing column throws RpcResultError", error instanceof RpcResultError, true);
  check("the error names the RPC", error?.rpc, "list_docket_matters");
  check("the error points at the row and column", error?.issues?.[0]?.path, [0, "rank"]);
  check(
    "the message says where",
    /list_docket_matters returned an unexpected result .*0\.rank/.test(error?.message ?? ""),
    true,
  );
}
check(
  "a wrong type throws",
  thrown(() => checkRpc("list_docket_matters", [{ ...boardRow(), rank: "0.5" }]))?.issues?.[0]
    ?.path,
  [0, "rank"],
);
check(
  "a null where the SQL never returns one throws",
  thrown(() => checkRpc("list_docket_matters", [{ ...boardRow(), case_number: null }]))?.issues?.[0]
    ?.path,
  [0, "case_number"],
);
check(
  "an unknown matter status throws",
  thrown(() =>
    checkRpc("search_docket_matters", [{ ...boardRow(), status: "closed_by_mistake" }]),
  ) instanceof RpcResultError,
  true,
);
check(
  "a malformed next date throws",
  thrown(() => checkRpc("find_next_available_docket_date", "02/11/2026")) instanceof RpcResultError,
  true,
);
check(
  "a result that is not a list throws",
  thrown(() => checkRpc("global_search", { rows: [] })) instanceof RpcResultError,
  true,
);
check(
  "an unknown global search type throws",
  thrown(() =>
    checkRpc("global_search", [
      { entity_type: "case_note", id: ID, title: "x", subtitle: null, headline: null, rank: 1 },
    ]),
  )?.issues?.[0]?.path,
  [0, "entity_type"],
);
check(
  "a booking result without a status throws",
  thrown(() =>
    checkRpc("set_docket_matter_next_date", [
      {
        event_id: ID,
        category_id: null,
        category_name: null,
        configured_capacity: null,
        scheduled_count: null,
        is_over_capacity: null,
      },
    ]),
  )?.issues?.[0]?.path,
  [0, "status"],
);
check(
  "a scoped search row without an id throws",
  thrown(() => checkRpcResult("search_judgments", searchIdRowsSchema, [{ title: "x" }]))?.rpc,
  "search_judgments",
);

// --- production: report, pass through ---------------------------------------

{
  const reported = [];
  const original = console.error;
  console.error = (...args) => reported.push(args);
  const bad = [{ ...boardRow(), rank: "high" }];
  let result;
  try {
    result = checkRpc("list_docket_matters", bad, { strict: false });
  } finally {
    console.error = original;
  }
  check("not strict: the rows come back unchanged", result === bad, true);
  check("not strict: the mismatch is reported once", reported.length, 1);
  check(
    "not strict: the report carries the typed error",
    reported[0]?.[1] instanceof RpcResultError,
    true,
  );
  check(
    "not strict: tagged as an rpc-result for the error tracker",
    reported[0]?.[0],
    "[rpc-result]",
  );
}

check(
  "outside a production build (this harness) the default is strict",
  thrown(() => checkRpc("list_docket_matters", [{}])) instanceof RpcResultError,
  true,
);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
