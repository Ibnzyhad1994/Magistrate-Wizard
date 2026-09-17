/**
 * Docket capacity strip vs board list contract (0139 + 0147/0148
 * total-matters count matching list_docket_matters day membership +
 * all-courts day click).
 *
 * Snapshot SQL still accepts optional p_court_id. The week strip must not
 * send it: tiles count every court the caller sits. Clicking a day writes
 * court=all and drops leftover next chips. SQL-string / source checks
 * only — no live database.
 *
 *   npm run test:docket-capacity
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMPTY_BOARD_PARAMS,
  boardParamsToSearchParams,
} from "../../src/lib/docket-board-params.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const snapshotSql = readFileSync(
  join(__dirname, "../../supabase/migrations/0148_docket_calendar_total_matches_board.sql"),
  "utf8",
);
const listSql = readFileSync(
  join(__dirname, "../../supabase/migrations/0139_docket_capacity_matches_board.sql"),
  "utf8",
);
const hookSrc = readFileSync(
  join(__dirname, "../../src/hooks/docket/use-docket-capacity.ts"),
  "utf8",
);
const stripSrc = readFileSync(
  join(__dirname, "../../src/pages/docket/docket-capacity-strip.tsx"),
  "utf8",
);
const listSrc = readFileSync(
  join(__dirname, "../../src/pages/docket/docket-list-page.tsx"),
  "utf8",
);

let failures = 0;
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
};

check(
  "0148 redefines get_docket_capacity_snapshot with optional p_court_id",
  /create function public\.get_docket_capacity_snapshot\([\s\S]*?p_court_id uuid default null/i.test(
    snapshotSql,
  ),
  true,
);
check("snapshot excludes binned matters", snapshotSql.includes("dm.deleted_at is null"), true);
check(
  "snapshot counts distinct matters, not event rows",
  snapshotSql.includes("count(distinct e.docket_matter_id)"),
  true,
);
check(
  "category utilisation still scopes to the calling magistrate",
  snapshotSql.includes("e.presiding_magistrate_id = (select auth.uid())"),
  true,
);
check(
  "snapshot does not apply list-style full-text search",
  /search_vector @@/.test(snapshotSql),
  false,
);
check(
  "snapshot returns total_matters_count",
  snapshotSql.includes("total_matters_count bigint"),
  true,
);
const dayTotalCte = snapshotSql.slice(
  snapshotSql.indexOf("with day_total as"),
  snapshotSql.indexOf("from public.docket_matter_categories"),
);
check("day-total CTE does not filter by event category", /e\.category_id/.test(dayTotalCte), false);
check(
  "day-total CTE does not require the caller to preside",
  /presiding_magistrate_id/.test(dayTotalCte),
  false,
);
check(
  "day-total CTE uses the board's non-entered_in_error appearance rule",
  dayTotalCte.includes("event_status <> 'entered_in_error'"),
  true,
);
check(
  "day-total CTE does not limit to scheduled/completed only",
  /event_status in \('scheduled', 'completed'\)/.test(dayTotalCte),
  false,
);
check("snapshot does not filter procedure_stage", /procedure_stage/.test(snapshotSql), false);
check("snapshot does not filter trial_status", /trial_status/.test(snapshotSql), false);
check(
  "list_docket_matters ignores next-date buckets when a day is selected",
  /p_exact_date is not null\s+or p_next_date is null/i.test(listSql),
  true,
);

const snapshotHook = hookSrc.slice(hookSrc.indexOf("export function useDocketCapacitySnapshot"));
check("strip snapshot hook does not send p_court_id", /p_court_id/.test(snapshotHook), false);
check(
  "capacity strip never passes courtId into the snapshot hook",
  /useDocketCapacitySnapshot\([^)]*courtId/.test(stripSrc),
  false,
);
check("capacity strip has no courtId prop", /courtId/.test(stripSrc), false);
check(
  "strip reads total_matters_count independently of the worst-category fraction",
  stripSrc.includes("total_matters_count") &&
    stripSrc.includes("totalMatters") &&
    stripSrc.includes("{worst.scheduled_count}/{worst.daily_capacity}"),
  true,
);
check(
  "strip renders the day total in its own pill",
  stripSrc.includes("loadPillClass") && stripSrc.includes("All: {selectedTotal}"),
  true,
);
check("strip is a walkthrough target", stripSrc.includes('data-tour="docket-week-strip"'), true);
check(
  "day click writes court=all in the same search-params write",
  listSrc.includes('next.set("court", ALL_COURTS_PARAM)'),
  true,
);
check(
  "court-dropdown wipe is Select onChange only (no courtId effect)",
  /previousCourtId/.test(listSrc),
  false,
);
check(
  "court Select still clears board params so a dropdown switch wipes the date",
  /clearBoardParams/.test(listSrc),
  true,
);

const withDateAndNext = {
  ...EMPTY_BOARD_PARAMS,
  exactDate: "2026-09-10",
  filters: { ...EMPTY_BOARD_PARAMS.filters, nextDate: ["today", "no_date"] },
};
const serialised = boardParamsToSearchParams(
  withDateAndNext,
  new URLSearchParams("court=supreme-id&next=today"),
);
check("board params drop next when a calendar date is set", serialised.has("next"), false);
check("board params keep the selected date", serialised.get("date"), "2026-09-10");
check(
  "board-params helper still preserves court; the list page then writes court=all on day click",
  serialised.get("court"),
  "supreme-id",
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
