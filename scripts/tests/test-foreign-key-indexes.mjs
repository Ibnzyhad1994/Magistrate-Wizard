// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * Every foreign key a parent delete follows has an index on its column
 * (0230), on a real database.
 *
 *   - The catalogue: every public foreign key whose first column leads no
 *     index is a `*_by -> profiles` audit column (profiles are never
 *     deleted; see 0230's header). A new unindexed foreign key fails here.
 *   - The plans: for each of 0230's seven columns, the lookup a parent
 *     delete runs (the ON DELETE action: `DELETE` or `UPDATE ... SET NULL`
 *     `WHERE <column> = <parent id>`) is planned on the new index. Sequential
 *     scans are switched off so the empty local tables cannot hide a missing
 *     index behind a cheaper scan: with no usable index the plan would still
 *     be a Seq Scan.
 *
 * Needs `psql` and the local stack (`npm run db:start`); reads only.
 *
 *   npm run test:foreign-key-indexes
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runSql, sections } from "../test-support/psql.mjs";

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

// The parent-delete action each column's foreign key runs (0230).
const LOOKUPS = [
  ["docket_capacity_overrides", "docket_event_id", "set null"],
  ["docket_capacity_overrides", "category_id", "set null"],
  ["docket_capacity_settings", "category_id", "cascade"],
  ["statutes", "primary_document_id", "set null"],
  ["court_non_sitting_days", "court_id", "cascade"],
  ["court_non_sitting_days", "district_id", "cascade"],
  ["webhook_endpoints", "court_id", "set null"],
];
const PARENT_ID = "00000000-0000-4000-8000-000000000000";

const unindexed = `select coalesce(json_agg(fk order by fk), '[]')
from (
  select c.conrelid::regclass::text || '.' || a.attname || ' -> ' || c.confrelid::regclass::text as fk
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f'
    and c.connamespace = 'public'::regnamespace
    and not exists (
      select 1 from pg_index i
      where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
    )
) f;`;

const plans = LOOKUPS.map(([table, column, action]) => {
  const statement =
    action === "cascade"
      ? `delete from only public.${table} where ${column} = '${PARENT_ID}'`
      : `update only public.${table} set ${column} = null where ${column} = '${PARENT_ID}'`;
  return `\\echo @@plan:${table}.${column}
explain (costs off) ${statement};`;
}).join("\n");

const out = sections(
  runSql(
    `begin;
set local enable_seqscan = off;
\\echo @@unindexed
${unindexed}
${plans}
rollback;`,
    "test:foreign-key-indexes",
  ),
);

const remaining = JSON.parse(out.unindexed);
console.log(`Unindexed foreign keys left (${remaining.length}):`);
for (const fk of remaining) console.log(`  ${fk}`);
check(
  "every unindexed foreign key is a *_by -> profiles audit column",
  remaining.filter((fk) => !/^[a-z0-9_]+\.[a-z0-9_]+_by -> profiles$/.test(fk)),
  [],
);

const planRows = [];
for (const [table, column] of LOOKUPS) {
  const plan = out[`plan:${table}.${column}`];
  const index = `${table}_${column}_idx`;
  console.log(`--- ${table}.${column}\n${plan}`);
  planRows.push(
    `| ${table}.${column} | ${plan
      .split("\n")
      .map((l) => l.trim())
      .join("; ")} |`,
  );
  check(`a parent delete finds ${table}.${column} by ${index}`, plan.includes(index), true);
  check(`a parent delete does not scan all of ${table}`, /Seq Scan/.test(plan), false);
}

// Also written to LIVE_REPORT_DIR when set: live-db.yml prints those files
// (the runner prints a script's output only when it fails).
if (process.env.LIVE_REPORT_DIR) {
  mkdirSync(process.env.LIVE_REPORT_DIR, { recursive: true });
  writeFileSync(
    path.join(process.env.LIVE_REPORT_DIR, "foreign-key-indexes.md"),
    [
      "### Foreign-key indexes (0230): the lookup each parent delete runs",
      "",
      "| Column | Plan (sequential scans off) |",
      "| --- | --- |",
      ...planRows,
      "",
      `Unindexed foreign keys left: ${remaining.length}, all \`*_by -> profiles\` audit columns.`,
      "",
    ].join("\n"),
  );
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll foreign-key index checks passed.");
