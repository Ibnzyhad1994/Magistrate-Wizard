/**
 * RPC rate-limit helper: SQL-string checks plus window-bucket math.
 *
 *   npm run test:rpc-rate-limit
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { rpcRateLimitWindowStart, rpcRateLimitWouldBlock } from "../../src/lib/rpc-rate-limit.ts"
import { getErrorMessage } from "../../src/lib/utils.ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(__dirname, "../../supabase/migrations/0137_rpc_rate_limits.sql"), "utf8")
const viewer = readFileSync(
  join(__dirname, "../../src/components/common/document-viewer-dialog.tsx"),
  "utf8",
)

let failures = 0
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`)
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected))
    console.log("  actual:  ", JSON.stringify(actual))
    failures += 1
  }
}

check("0137 creates buckets table", sql.includes("create table public.rpc_rate_limit_buckets"), true)
check("0137 defines enforce_rpc_rate_limit", sql.includes("create or replace function public.enforce_rpc_rate_limit"), true)
check("0137 raises rate_limited", sql.includes("raise exception 'rate_limited'"), true)

const wrapped = [
  "global_search",
  "search_docket_matters",
  "search_case_law",
  "search_case_law_scoped",
  "search_judgments",
  "search_statutes",
  "search_bench_notes",
  "download_my_data",
]
for (const name of wrapped) {
  check(
    `${name} calls enforce_rpc_rate_limit`,
    sql.includes(`perform public.enforce_rpc_rate_limit('${name}'`),
    true,
  )
}

check("download_my_data is 5 per 60s", sql.includes("enforce_rpc_rate_limit('download_my_data', 5, 60)"), true)
check("does not wrap list_docket_matters", sql.includes("enforce_rpc_rate_limit('list_docket_matters'"), false)
check("does not wrap is_admin", sql.includes("enforce_rpc_rate_limit('is_admin'"), false)

const t = Date.UTC(2026, 8, 3, 15, 0, 30)
check("window truncates to 60s", rpcRateLimitWindowStart(t, 60), t / 1000 - 30)
check("60th hit is allowed", rpcRateLimitWouldBlock(60, 60), false)
check("61st hit is blocked", rpcRateLimitWouldBlock(61, 60), true)
check(
  "rate_limited maps to a toast",
  getErrorMessage({ message: "rate_limited" }),
  "Too many requests. Try again in a minute.",
)

check("document viewer enables redact", /allowRedact/.test(viewer), true)

const sql138 = readFileSync(join(__dirname, "../../supabase/migrations/0138_revoke_anon_search.sql"), "utf8")
check("0138 revokes anon search", sql138.includes("revoke all on function public.global_search"), true)
check("0138 keeps authenticated execute", sql138.includes("grant execute on function public.global_search"), true)

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
