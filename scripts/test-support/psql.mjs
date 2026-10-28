/**
 * Plain SQL against the local Supabase database, for live tests that need
 * what the Data API cannot give them: EXPLAIN plans, a seeded dataset inside
 * one transaction that is rolled back, or a server-only function.
 *
 * Uses the `psql` client (live-db.yml's runner has it) and the local stack's
 * well-known database URL. SUPABASE_DB_URL overrides it; a non-local host is
 * refused unless ALLOW_REMOTE_SUPABASE=1, as for the API URL.
 *
 * `runSql(script)` runs the script with ON_ERROR_STOP and returns stdout.
 * `sections(stdout)` splits output written as `\echo @@<label>` followed by
 * a query's rows into { label: text }.
 */
import { spawnSync } from "node:child_process";
import { assertLocalSupabase } from "./assert-local-supabase.mjs";

export const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:56322/postgres";

export function runSql(script, testName = "this test") {
  assertLocalSupabase(DB_URL, testName);
  const result = spawnSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", DB_URL], {
    input: script,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new Error(`psql could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`psql exited ${result.status}:\n${result.stderr}`);
  }
  return result.stdout;
}

export function sections(stdout) {
  const out = {};
  let label = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("@@")) {
      label = line.slice(2).trim();
      out[label] = "";
    } else if (label) {
      out[label] += `${line}\n`;
    }
  }
  for (const key of Object.keys(out)) out[key] = out[key].trim();
  return out;
}
