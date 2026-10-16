/**
 * Callover matters on the day's schedule.
 *
 * Regression for: a matter entered on a callover sheet was missing from
 * that day's Calendar and Docket day list, because entering it only wrote
 * a docket_callover_items row and the schedule reads docket_events alone.
 * Listing a callover matter now writes its appearance on the sitting day.
 *
 * The rules are pure; the listing order runs against a recording fake
 * client. test-callover-schedule-db.mjs proves the same flow on a real
 * database.
 *
 *   npm run test:callover-schedule
 */
import {
  CALLOVER_EVENT_TYPE,
  calloverAppearance,
  calloverMatterKey,
  calloverMatterKeys,
  itemsMissingFromSchedule,
  listCalloverMatter,
} from "../../src/lib/callover-schedule.ts";

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

// --- marking the schedule -------------------------------------------------

const keys = calloverMatterKeys([
  { callover_date: "2026-10-16", docket_callover_items: [{ docket_matter_id: "m1" }] },
  {
    callover_date: "2026-10-17",
    docket_callover_items: [{ docket_matter_id: "m1" }, { docket_matter_id: "m2" }],
  },
  { callover_date: "2026-10-18", docket_callover_items: null },
]);
check(
  "a matter is marked on the day of its callover",
  keys.has(calloverMatterKey("2026-10-16", "m1")),
  true,
);
check(
  "a matter is not marked on a day it was not called over",
  keys.has(calloverMatterKey("2026-10-16", "m2")),
  false,
);
check("every (day, matter) pair is kept", keys.size, 3);

// --- what appearance a sheet row stands for --------------------------------

check(
  "a row not yet called is listed for the day",
  calloverAppearance({ called_at: null, outcome: null }),
  { eventStatus: "scheduled", outcome: null },
);
check(
  "a called row is filed as a completed appearance with its outcome",
  calloverAppearance({ called_at: "2026-10-16T10:00:00Z", outcome: " Adjourned " }),
  { eventStatus: "completed", outcome: "Adjourned" },
);
check(
  "a called row with no outcome is completed without inventing one",
  calloverAppearance({ called_at: "2026-10-16T10:00:00Z", outcome: "" }),
  { eventStatus: "completed", outcome: null },
);

check(
  "only rows with no appearance that day are off the schedule",
  itemsMissingFromSchedule(
    [{ docket_matter_id: "a" }, { docket_matter_id: "b" }, { docket_matter_id: "c" }],
    new Set(["b"]),
  ).map((row) => row.docket_matter_id),
  ["a", "c"],
);

// --- listing order -----------------------------------------------------------

/** A thenable query builder that records every call and answers from `respond`. */
function fakeClient(respond) {
  const calls = [];
  const builder = (table) => {
    const query = { table, ops: [] };
    const proxy = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "then") {
            return (resolve, reject) => Promise.resolve(respond.from(query)).then(resolve, reject);
          }
          return (...args) => {
            query.ops.push([prop, ...args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  return {
    calls,
    rpc: async (fn, args) => {
      calls.push(["rpc", fn, args]);
      return respond.rpc(fn, args);
    },
    from: (table) => {
      calls.push(["from", table]);
      return builder(table);
    },
  };
}

const created = { status: "created", event_id: "e1" };
const input = {
  matterId: "m1",
  courtId: "c1",
  date: "2026-10-16",
  categoryId: "cat",
  stageAtEvent: "Trial",
};

{
  const writes = [];
  const client = fakeClient({
    rpc: () => ({ data: [created], error: null }),
    from: (query) => {
      const op = query.ops[0]?.[0];
      if (op === "insert") writes.push([query.table, query.ops[0][1]]);
      if (query.table === "docket_callovers" && op === "select") return { data: null, error: null };
      if (query.table === "docket_callovers" && op === "insert") {
        return { data: { id: "co-new" }, error: null };
      }
      if (query.table === "docket_callover_items" && op === "select") {
        return { count: 2, error: null };
      }
      return { data: null, error: null };
    },
  });
  const result = await listCalloverMatter(client, input);
  const [first] = client.calls;
  check(
    "the appearance is written first, through the capacity-checked RPC",
    first[1],
    "schedule_docket_event_with_capacity",
  );
  check(
    "it is a Callover appearance on the sitting day",
    [first[2].p_event_type, first[2].p_scheduled_date, first[2].p_event_status],
    [CALLOVER_EVENT_TYPE, "2026-10-16", "scheduled"],
  );
  check(
    "it never goes through set_docket_matter_next_date, which would supersede a later hearing",
    client.calls.some((call) => call[1] === "set_docket_matter_next_date"),
    false,
  );
  check("with no open sitting that day, one is started", writes[0], [
    "docket_callovers",
    { court_id: "c1", callover_date: "2026-10-16" },
  ]);
  check("the matter joins the end of that sheet", writes[1], [
    "docket_callover_items",
    { callover_id: "co-new", docket_matter_id: "m1", sort_order: 3 },
  ]);
  check("the result names the event and the sheet", result, {
    status: "created",
    eventId: "e1",
    calloverId: "co-new",
  });
}

{
  const client = fakeClient({
    rpc: () => ({
      data: [
        {
          status: "capacity_reached",
          category_id: "cat",
          configured_capacity: 3,
          scheduled_count: 3,
        },
      ],
      error: null,
    }),
    from: () => ({ data: null, error: null }),
  });
  const result = await listCalloverMatter(client, input);
  check(
    "a refused capacity check comes back for the override prompt",
    result.status,
    "capacity_reached",
  );
  check("and nothing else is written", client.calls.length, 1);
}

{
  const writes = [];
  const client = fakeClient({
    rpc: () => ({ data: [created], error: null }),
    from: (query) => {
      const op = query.ops[0]?.[0];
      if (op === "insert") writes.push(query.table);
      if (query.table === "docket_callover_items" && op === "select")
        return { count: 0, error: null };
      if (query.table === "docket_callover_items" && op === "insert") {
        return { data: null, error: { code: "23505", message: "duplicate" } };
      }
      return { data: null, error: null };
    },
  });
  const result = await listCalloverMatter(client, { ...input, calloverId: "co-sheet" });
  check("entered on a sheet, it joins that sheet without looking for another", writes, [
    "docket_callover_items",
  ]);
  check("a matter already on the sheet is not an error", result.calloverId, "co-sheet");
}

{
  let finds = 0;
  const client = fakeClient({
    rpc: () => ({ data: [created], error: null }),
    from: (query) => {
      const op = query.ops[0]?.[0];
      if (query.table === "docket_callovers" && op === "select") {
        finds += 1;
        return { data: finds === 1 ? null : { id: "co-winner" }, error: null };
      }
      if (query.table === "docket_callovers" && op === "insert") {
        return { data: null, error: { code: "23505", message: "open per court and date" } };
      }
      if (query.table === "docket_callover_items" && op === "select")
        return { count: 0, error: null };
      return { data: null, error: null };
    },
  });
  const result = await listCalloverMatter(client, input);
  check(
    "losing the race to start the day's sitting joins the winner",
    result.calloverId,
    "co-winner",
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll callover schedule checks passed.");
