/**
 * Keyset paging helpers (BE-15): the PostgREST filters a page sends, the
 * cursor a page hands on, and when a list counts as complete.
 *
 * The live proof that these filters page real tables completely and in
 * order is test-list-keyset-paging.mjs; this one pins the exact filter text
 * and the edge cases (quoting, null cursors, exact-multiple lists).
 *
 *   npm run test:keyset-pagination
 */
import {
  applyKeyset,
  cursorFromRow,
  keysetAfterFilter,
  nextKeysetCursor,
  quotePostgrestValue,
  toKeysetPage,
} from "@/lib/keyset-pagination";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}
function throws(label, fn) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  check(label, threw, true);
}

const NEWEST = {
  columns: [
    { column: "updated_at", ascending: false },
    { column: "id", ascending: false },
  ],
  pageSize: 3,
};
const BY_TITLE = {
  columns: [
    { column: "title", ascending: true },
    { column: "id", ascending: true },
  ],
  pageSize: 3,
};
const PULSE = {
  columns: [
    { column: "scheduled_date", ascending: true },
    { column: "scheduled_time", ascending: true, nullsFirst: true },
    { column: "id", ascending: true },
  ],
  pageSize: 3,
};

// --- quoting -------------------------------------------------------------
check("plain value is double-quoted", quotePostgrestValue("abc"), '"abc"');
check(
  "quotes and backslashes are escaped, reserved characters kept inside the quotes",
  quotePostgrestValue('Act, "No. 2" (a)\\b'),
  '"Act, \\"No. 2\\" (a)\\\\b"',
);

// --- the "after cursor" filter -------------------------------------------
check(
  "descending two-column key",
  keysetAfterFilter(NEWEST, ["2026-10-28T10:00:00.123456+00:00", "id-9"]),
  'updated_at.lt."2026-10-28T10:00:00.123456+00:00",and(updated_at.eq."2026-10-28T10:00:00.123456+00:00",id.lt."id-9")',
);
check(
  "ascending text key keeps a comma in the title inside its quotes",
  keysetAfterFilter(BY_TITLE, ["Act, Cap. 1", "id-1"]),
  'title.gt."Act, Cap. 1",and(title.eq."Act, Cap. 1",id.gt."id-1")',
);
check(
  "nulls-first middle column with a value: nulls are already behind the cursor",
  keysetAfterFilter(PULSE, ["2026-10-01", "09:30:00", "id-2"]),
  'scheduled_date.gt."2026-10-01",and(scheduled_date.eq."2026-10-01",or(scheduled_time.gt."09:30:00",and(scheduled_time.eq."09:30:00",id.gt."id-2")))',
);
check(
  "nulls-first middle column at null: the remaining nulls, then every timed row",
  keysetAfterFilter(PULSE, ["2026-10-01", null, "id-2"]),
  'scheduled_date.gt."2026-10-01",and(scheduled_date.eq."2026-10-01",or(scheduled_time.not.is.null,and(scheduled_time.is.null,id.gt."id-2")))',
);
throws("a null in a column not declared nullsFirst is refused", () =>
  keysetAfterFilter(NEWEST, [null, "id-1"]),
);
throws("a null leading column is refused", () =>
  keysetAfterFilter(PULSE, [null, "09:00:00", "id-1"]),
);
throws("a cursor of the wrong length is refused", () => keysetAfterFilter(NEWEST, ["x"]));

// --- applyKeyset drives the builder -------------------------------------
function recorder() {
  const calls = [];
  const builder = {};
  for (const method of ["order", "gte", "lte", "or", "limit"]) {
    builder[method] = (...args) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  return { builder, calls };
}
{
  const { builder, calls } = recorder();
  applyKeyset(builder, NEWEST, null);
  check("first page: order by the whole key and limit, no cursor filters", calls, [
    ["order", "updated_at", { ascending: false }],
    ["order", "id", { ascending: false }],
    ["limit", 3],
  ]);
}
{
  const { builder, calls } = recorder();
  applyKeyset(builder, NEWEST, ["2026-10-28T10:00:00+00:00", "id-9"]);
  check("descending next page: range bound <= on the leading column", calls[0], [
    "lte",
    "updated_at",
    "2026-10-28T10:00:00+00:00",
  ]);
  check("then the exact or-tree", calls[1][0], "or");
}
{
  const { builder, calls } = recorder();
  applyKeyset(builder, PULSE, ["2026-10-01", null, "id-2"]);
  check("ascending next page: range bound >= on the leading column", calls[0], [
    "gte",
    "scheduled_date",
    "2026-10-01",
  ]);
  check(
    "nulls-first column is ordered nulls first",
    calls.find((c) => c[0] === "order" && c[1] === "scheduled_time"),
    ["order", "scheduled_time", { ascending: true, nullsFirst: true }],
  );
}

// --- pages and completion -----------------------------------------------
const row = (id, t = "2026-10-28T10:00:00+00:00") => ({ id, updated_at: t, title: "x" });
check(
  "cursor reads the key columns of a row, in key order",
  cursorFromRow(PULSE, { id: "e1", scheduled_date: "2026-10-01", scheduled_time: null }),
  ["2026-10-01", null, "e1"],
);
const full = toKeysetPage([row("c"), row("b"), row("a")], NEWEST, 7);
check("a full page hands on its last row as the cursor", full.nextCursor, [
  "2026-10-28T10:00:00+00:00",
  "a",
]);
const short = toKeysetPage([row("a")], NEWEST, null);
check("a short page ends the list", short.nextCursor, null);
check("an empty page ends the list", toKeysetPage([], NEWEST, 0).nextCursor, null);
check("next page after a full first page of seven", nextKeysetCursor([full]), full.nextCursor);
check("no next page after a short page", nextKeysetCursor([full, short]), undefined);
const exact = toKeysetPage([row("c"), row("b"), row("a")], NEWEST, 3);
check(
  "no empty extra round trip when the list is an exact multiple of the page size",
  nextKeysetCursor([exact]),
  undefined,
);
check(
  "an unknown total falls back to the page length",
  nextKeysetCursor([toKeysetPage([row("c"), row("b"), row("a")], NEWEST, null)]),
  ["2026-10-28T10:00:00+00:00", "a"],
);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
