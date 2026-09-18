/**
 * Selecting files to adjourn together (D2).
 *
 * The rule this test exists for: set_docket_matter_next_date supersedes
 * the earliest appearance ON OR AFTER today and takes no context date, so
 * run from yesterday's list it would cancel TOMORROW's appearance and
 * file a scheduled row in the past. Bulk adjourn must therefore be
 * offered only for today or later.
 *
 *   npm run test:docket-selection
 */
import {
  bucketByCategory,
  canBulkAdjourn,
  forecastCapacity,
  pruneSelection,
  selectAll,
  selectableIds,
  summariseBulk,
  toggleSelection,
} from "../../src/lib/docket-selection.ts";

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

const TODAY = "2026-09-18";

// --- the guard ------------------------------------------------------------

check("a past date must never offer bulk adjourn", canBulkAdjourn("2026-09-17", TODAY), false);
check("today is allowed", canBulkAdjourn(TODAY, TODAY), true);
check("a future date is allowed", canBulkAdjourn("2026-10-01", TODAY), true);
check("no date at all is not", canBulkAdjourn(null, TODAY), false);

// --- selection ------------------------------------------------------------

const rows = [
  { id: "a", can_edit: true, category_id: "trial" },
  { id: "b", can_edit: false, category_id: "trial" },
  { id: "c", can_edit: true, category_id: "maintenance" },
  { id: "d", can_edit: true, category_id: null },
];

check("read-only rows are not selectable", selectableIds(rows), ["a", "c", "d"]);
check("select-all takes only editable rows", [...selectAll(rows)].sort(), ["a", "c", "d"]);
check("toggling adds", [...toggleSelection(new Set(), "a")], ["a"]);
check("toggling again removes", [...toggleSelection(new Set(["a"]), "a")], []);

check(
  "a row that left the list is dropped from the selection",
  [...pruneSelection(new Set(["a", "c"]), [rows[0]])],
  ["a"],
);
check(
  "a row that became read-only is dropped too",
  [...pruneSelection(new Set(["a"]), [{ id: "a", can_edit: false }])],
  [],
);

// --- capacity forecast ----------------------------------------------------

const selected = new Set(["a", "c", "d"]);
check("the selection is bucketed by category", bucketByCategory(rows, selected), [
  { categoryId: "trial", count: 1 },
  { categoryId: "maintenance", count: 1 },
  { categoryId: null, count: 1 },
]);

const snapshot = [
  { category_id: "trial", category_name: "Criminal trial", daily_capacity: 2, scheduled_count: 2 },
  {
    category_id: "maintenance",
    category_name: "Maintenance matter",
    daily_capacity: 5,
    scheduled_count: 1,
  },
];
const forecast = forecastCapacity(bucketByCategory(rows, selected), snapshot);
check(
  "a category already at its limit reports the overflow",
  forecast.find((f) => f.categoryId === "trial"),
  {
    categoryId: "trial",
    categoryName: "Criminal trial",
    selected: 1,
    limit: 2,
    alreadyScheduled: 2,
    over: 1,
  },
);
check(
  "a category with room reports none",
  forecast.find((f) => f.categoryId === "maintenance").over,
  0,
);
check(
  "a category with no configured limit is never over",
  forecast.find((f) => f.categoryId === null),
  {
    categoryId: null,
    categoryName: "No category",
    selected: 1,
    limit: null,
    alreadyScheduled: 0,
    over: 0,
  },
);

// --- partial success ------------------------------------------------------

check(
  "a wholly successful batch reads plainly",
  summariseBulk(
    [
      { matterId: "a", status: "created" },
      { matterId: "c", status: "created" },
    ],
    "3 November",
  ).sentence,
  "2 matters adjourned to 3 November.",
);
check(
  "a partial batch reports both halves, and keeps the failures",
  summariseBulk(
    [
      { matterId: "a", status: "created" },
      { matterId: "c", status: "capacity_reached" },
      { matterId: "d", status: "capacity_reached" },
    ],
    "3 November",
  ),
  {
    done: 1,
    failed: [
      { matterId: "c", status: "capacity_reached" },
      { matterId: "d", status: "capacity_reached" },
    ],
    sentence: "1 matter adjourned to 3 November. 2 need attention.",
  },
);
check(
  "a wholly failed batch does not claim anything was done",
  summariseBulk([{ matterId: "a", status: "capacity_reached" }], "3 November").sentence,
  "1 needs attention.",
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
