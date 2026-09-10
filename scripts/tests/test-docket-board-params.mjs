import {
  BOARD_PARAM_KEYS,
  EMPTY_BOARD_PARAMS,
  boardParamsFromSearchParams,
  boardParamsToSearchParams,
  clearBoardParams,
  hasBoardParams,
} from "../../src/lib/docket-board-params.ts";

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

const parse = (search) => boardParamsFromSearchParams(new URLSearchParams(search));
const serialise = (state, base = "") =>
  boardParamsToSearchParams(state, new URLSearchParams(base)).toString();

// --- defaults ------------------------------------------------------------

check("a bare /docket URL parses to the empty board (no filters, no date)", parse(""), EMPTY_BOARD_PARAMS);

check(
  "the empty board serialises to an empty query string — the default view stays a clean URL",
  serialise(EMPTY_BOARD_PARAMS),
  "",
);

check(
  "serialising the empty board strips previously-set params rather than writing them blank",
  serialise(EMPTY_BOARD_PARAMS, "q=smith&stage=trial&date=2026-09-10"),
  "",
);

// --- search text ---------------------------------------------------------

check("search text round-trips", parse("q=smith").query, "smith");
check("search text is trimmed on the way in", parse("q=%20%20smith%20%20").query, "smith");
check(
  "whitespace-only search is treated as absent, not as a query for spaces",
  parse("q=%20%20").query,
  "",
);
check(
  "whitespace-only search is not written back to the URL",
  serialise({ ...EMPTY_BOARD_PARAMS, query: "   " }),
  "",
);

// --- filter validation ---------------------------------------------------

check(
  "known filter values parse",
  parse("stage=trial,ruling&custody=remanded&disclosure=partial&trial=completed&next=today").filters,
  {
    stages: ["trial", "ruling"],
    custody: ["remanded"],
    disclosure: ["partial"],
    trial: ["completed"],
    nextDate: ["today"],
  },
);

check(
  "unknown filter values are dropped, never passed through to the RPC",
  parse("stage=trial,not_a_stage,DROP%20TABLE&custody=bribery").filters,
  { ...EMPTY_BOARD_PARAMS.filters, stages: ["trial"] },
);

check(
  "an entirely invalid filter list degrades to no filter rather than erroring",
  parse("stage=nonsense").filters.stages,
  [],
);

check(
  "'unset' is a real custody status but not a filterable one — it is rejected",
  parse("custody=unset,on_bail").filters.custody,
  ["on_bail"],
);

check(
  "duplicates collapse so one view has one cache key",
  parse("stage=trial,trial,trial").filters.stages,
  ["trial"],
);

check(
  "filter order is canonicalised, so two URLs describing the same view share a query key",
  parse("stage=ruling,trial").filters.stages,
  parse("stage=trial,ruling").filters.stages,
);

check("empty filter params parse as empty", parse("stage=&custody=").filters.stages, []);

// --- date validation -----------------------------------------------------

check("a valid ISO date round-trips", parse("date=2026-09-10").exactDate, "2026-09-10");
check("a malformed date is dropped", parse("date=10-09-2026").exactDate, null);
check("a non-date string is dropped", parse("date=tomorrow").exactDate, null);
check(
  "a well-formed but non-existent calendar date is dropped (never silently rolled over)",
  parse("date=2026-02-31").exactDate,
  null,
);
check("month 13 is dropped", parse("date=2026-13-01").exactDate, null);
check("a leap day in a leap year is accepted", parse("date=2024-02-29").exactDate, "2024-02-29");
check("a leap day in a non-leap year is dropped", parse("date=2026-02-29").exactDate, null);

// --- full round-trip -----------------------------------------------------

const populated = {
  query: "smith",
  filters: {
    stages: ["trial"],
    custody: ["remanded"],
    disclosure: ["partial"],
    trial: ["completed"],
    nextDate: ["today"],
  },
  exactDate: null,
};

check(
  "a fully-populated board without a calendar day keeps next-date chips",
  parse(serialise(populated)),
  populated,
);

check(
  "selecting a calendar day drops next from the URL (date and next cannot fight)",
  new URLSearchParams(
    serialise({
      ...populated,
      exactDate: "2026-09-10",
      filters: { ...populated.filters, nextDate: ["today"] },
    }),
  ).has("next"),
  false,
);

check(
  "selecting a calendar day keeps stage filters and search",
  parse(
    serialise({
      ...populated,
      exactDate: "2026-09-10",
      filters: { ...populated.filters, nextDate: ["today"] },
    }),
  ),
  {
    query: "smith",
    filters: {
      stages: ["trial"],
      custody: ["remanded"],
      disclosure: ["partial"],
      trial: ["completed"],
      nextDate: [],
    },
    exactDate: "2026-09-10",
  },
);

// --- coexistence with ?court= (owned by docket-scope.ts) -----------------

check(
  "serialising preserves ?court=, which this module does not own",
  new URLSearchParams(serialise(populated, "court=vigilance-id")).get("court"),
  "vigilance-id",
);

check(
  "clearing board params leaves ?court= intact — a scope switch keeps the scope, drops the filters",
  clearBoardParams(new URLSearchParams("court=vigilance-id&q=smith&stage=trial&date=2026-09-10")).toString(),
  "court=vigilance-id",
);

check(
  "clearing board params removes every board key",
  BOARD_PARAM_KEYS.filter((key) =>
    clearBoardParams(new URLSearchParams(BOARD_PARAM_KEYS.map((k) => `${k}=x`).join("&"))).has(key),
  ),
  [],
);

check(
  "?court= alone is not treated as a board param",
  hasBoardParams(new URLSearchParams("court=vigilance-id")),
  false,
);

check("hasBoardParams is false for a bare URL", hasBoardParams(new URLSearchParams("")), false);
check("hasBoardParams is true when a filter is set", hasBoardParams(new URLSearchParams("stage=trial")), true);
check(
  "hasBoardParams ignores a blank param value",
  hasBoardParams(new URLSearchParams("q=%20")),
  false,
);

if (failures > 0) {
  console.log(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll docket-board-params tests passed.");
