/**
 * Judgment version history: trigger SQL + draft-only restore.
 *
 *   npm run test:judgment-versions
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { canRestoreJudgmentVersion } from "../../src/lib/judgment-versions.ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(
  join(__dirname, "../../supabase/migrations/0122_judgment_versions.sql"),
  "utf8",
)

let failures = 0
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`)
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected))
    console.log("  actual:  ", JSON.stringify(actual))
    failures += 1
  }
}

check("migration creates judgment_versions", sql.includes("create table public.judgment_versions"), true)
check("trigger copies previous content on update", sql.includes("capture_judgment_version"), true)
check("trigger is BEFORE UPDATE on judgments", /before update on public.judgments/i.test(sql), true)
check("owner SELECT RLS is present", sql.includes("Owners can view Judgment versions"), true)
check("no client UPDATE policy on versions", !/on public.judgment_versions for update/i.test(sql), true)
check("restore allowed on draft", canRestoreJudgmentVersion("draft"), true)
check("restore refused on final", canRestoreJudgmentVersion("final"), false)

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
