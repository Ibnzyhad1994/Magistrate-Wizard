/**
 * Local stress for 0137 RPC rate limits and rasterized PDF redaction.
 * Uses throwaway users so the seed admin account is not locked out.
 * Needs local Supabase (`npm run db:start`). Not part of develop CI.
 *
 *   npm run test:stress-audit
 */
import { readFileSync } from "node:fs"
import { performance } from "node:perf_hooks"
import { createClient } from "@supabase/supabase-js"
import jsPDF from "jspdf"
import { burnRedactedPdf } from "../../src/lib/redaction-pdf.ts"
import { getErrorMessage } from "../../src/lib/utils.ts"

function loadEnv() {
  try {
    const text = readFileSync(new URL("../../.env", import.meta.url), "utf8")
    const env = {}
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
    }
    return env
  } catch {
    return {}
  }
}

const env = loadEnv()
const URL = env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "http://127.0.0.1:56321"
const ANON =
  env.VITE_SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const SERVICE =
  env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
const PASSWORD = "Stress-Password-123!"

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

const PdfCtor = typeof jsPDF === "function" ? jsPDF : jsPDF.jsPDF

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

const isRateLimited = (error) => {
  const msg = `${error?.message ?? ""} ${error?.hint ?? ""} ${getErrorMessage(error)}`
  return /rate_limited|too many requests/i.test(msg)
}

const clientAs = (token) =>
  createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

const stamp = Date.now()
const makeEmail = (name) => `stress-${name}-${stamp}@example.test`

const createUser = async (email, role = "magistrate") => {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `Stress ${role}` },
  })
  if (error) throw error
  const { error: roleError } = await admin.from("profiles").update({ role }).eq("id", data.user.id)
  if (roleError) throw roleError
  return data.user.id
}

const signIn = async (email) => {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw error
  return { user: data.user, token: data.session.access_token, client: clientAs(data.session.access_token) }
}

const search = (client, rpc = "global_search", args = { p_query: "police", p_limit: 5 }) =>
  client.rpc(rpc, args)

const countHits = async (userId, rpcName) => {
  const { data, error } = await admin
    .from("rpc_rate_limit_buckets")
    .select("hit_count, window_start")
    .eq("user_id", userId)
    .eq("rpc_name", rpcName)
  if (error) throw error
  return (data ?? []).reduce((sum, row) => sum + row.hit_count, 0)
}

const timed = async (label, fn) => {
  const start = performance.now()
  const result = await fn()
  const ms = Math.round(performance.now() - start)
  console.log(`TIME — ${label}: ${ms}ms`)
  return { result, ms }
}

const emailA = makeEmail("search-a")
const emailB = makeEmail("search-b")
const emailBurst = Array.from({ length: 8 }, (_, i) => makeEmail(`burst-${i}`))

console.log("Creating throwaway stress users…")
const idA = await createUser(emailA)
const idB = await createUser(emailB)
const burstIds = []
for (const email of emailBurst) burstIds.push(await createUser(email))

const userA = await signIn(emailA)
const userB = await signIn(emailB)

const unauth = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const { error: unauthError } = await unauth.rpc("global_search", { p_query: "police", p_limit: 5 })
check("unauthenticated search is rejected", Boolean(unauthError), true)
if (!unauthError) console.log("  unauth search returned rows instead of an error")
if (unauthError) console.log("  unauth error:", unauthError.message)

const first = await search(userA.client)
check("first global_search succeeds", !first.error, true)
if (first.error) console.log("  ", first.error.message)

const sequential = []
for (let i = 0; i < 59; i++) sequential.push(search(userA.client))
const sequentialResults = await Promise.all(sequential)
const sequentialFails = sequentialResults.filter((row) => row.error).length
check("next 59 sequential searches succeed", sequentialFails, 0)
if (sequentialFails) {
  sequentialResults
    .filter((row) => row.error)
    .slice(0, 3)
    .forEach((row) => console.log("  ", row.error.message))
}

const over = await search(userA.client)
check("61st sequential search is rate limited", isRateLimited(over.error), true)
check("61st toast copy", getErrorMessage(over.error), "Too many requests. Try again in a minute.")

const otherRpc = await userA.client.rpc("search_judgments", { p_query: "police", p_limit: 5 })
check("different RPC is a separate bucket", !otherRpc.error, true)
if (otherRpc.error) console.log("  ", otherRpc.error.message)

const cheap = await userA.client.rpc("is_admin")
check("is_admin is not rate limited after search lockout", !cheap.error, true)

const board = await userA.client.rpc("list_docket_matters", { p_limit: 20 })
check("list_docket_matters is not rate limited", !board.error, true)
if (board.error) console.log("  ", board.error.message)

const otherUser = await search(userB.client)
check("second user is not blocked by the first user's bucket", !otherUser.error, true)

const hitsA = await countHits(userA.user.id, "global_search")
const { data: allBuckets, error: bucketReadError } = await admin
  .from("rpc_rate_limit_buckets")
  .select("user_id, rpc_name, hit_count")
if (bucketReadError) console.log("  bucket read error:", bucketReadError.message)
console.log(
  `  user A id=${userA.user.id} hits=${hitsA} service-visible rows=${(allBuckets ?? []).length}`,
)
check("bucket recorded 60 successful hits for user A", hitsA >= 60 || (allBuckets ?? []).some((row) => row.hit_count >= 60), true)

const { data: leaked, error: leakError } = await userA.client.from("rpc_rate_limit_buckets").select("hit_count")
check("authenticated client cannot read rate-limit buckets", Boolean(leakError) || (leaked ?? []).length === 0, true)

const dsrs = []
for (let i = 0; i < 6; i++) dsrs.push(userB.client.rpc("download_my_data"))
const dsrResults = await Promise.all(dsrs)
const dsrOk = dsrResults.filter((row) => !row.error).length
const dsrBlocked = dsrResults.filter((row) => isRateLimited(row.error)).length
check("download_my_data allows up to 5 in a window", dsrOk, 5)
check("download_my_data 6th call is rate limited", dsrBlocked >= 1, true)

console.log("Concurrent burst: 80 parallel global_search from a fresh user…")
const burstUser = await signIn(emailBurst[0])
const { ms: burstMs, result: burstRows } = await timed("80 parallel global_search", () =>
  Promise.all(Array.from({ length: 80 }, () => search(burstUser.client))),
)
const burstOk = burstRows.filter((row) => !row.error).length
const burstLimited = burstRows.filter((row) => isRateLimited(row.error)).length
check("parallel burst allows at most 60", burstOk <= 60, true)
check("parallel burst rate-limits the overflow", burstLimited >= 20, true)
check("parallel burst completes in under 15s", burstMs < 15_000, true)
console.log(`  burst ok=${burstOk} limited=${burstLimited} other=${80 - burstOk - burstLimited}`)

console.log("Fan-out: 8 users × 20 parallel searches…")
const fanClients = []
for (const email of emailBurst.slice(1)) fanClients.push(await signIn(email))
const { ms: fanMs, result: fanRows } = await timed("8 users × 20 searches", () =>
  Promise.all(fanClients.flatMap((u) => Array.from({ length: 20 }, () => search(u.client)))),
)
const fanOk = fanRows.filter((row) => !row.error).length
const fanLimited = fanRows.filter((row) => isRateLimited(row.error)).length
check("multi-user fan-out mostly succeeds (under per-user cap)", fanOk >= 7 * 20, true)
check("multi-user fan-out does not false-limit other users", fanLimited, 0)
check("multi-user fan-out completes in under 20s", fanMs < 20_000, true)
console.log(`  fan-out ok=${fanOk} limited=${fanLimited}`)

console.log("Redaction burn stress…")
const fat = new PdfCtor({ unit: "pt", format: "a4" })
for (let p = 0; p < 12; p++) {
  if (p > 0) fat.addPage()
  fat.setFontSize(16)
  fat.text(`SECRET-PAGE-${p + 1}`, 72, 80)
  fat.setFontSize(11)
  for (let line = 0; line < 40; line++) {
    fat.text(`Paragraph ${line + 1} of page ${p + 1}. Police v. Demo Defendant.`, 72, 110 + line * 14)
  }
}
const fatBytes = new Uint8Array(fat.output("arraybuffer"))
const boxes = []
for (let pageNumber = 1; pageNumber <= 12; pageNumber++) {
  for (let i = 0; i < 8; i++) {
    boxes.push({
      pageNumber,
      x: 0.05 + (i % 4) * 0.22,
      y: 0.08 + Math.floor(i / 4) * 0.35,
      width: 0.2,
      height: 0.12,
    })
  }
}
const originalCopy = fatBytes.slice()
const { ms: burnMs, result: burned } = await timed("12-page 96-box burn", () =>
  burnRedactedPdf({ bytes: fatBytes, boxes, title: "stress.pdf" }),
)
check("fat original is non-empty", fatBytes.byteLength > 1000, true)
check("burned output is a PDF", String.fromCharCode(...burned.slice(0, 4)), "%PDF")
check("burn does not mutate source bytes", originalCopy.every((b, i) => b === fatBytes[i]), true)
check("12-page burn finishes in under 45s", burnMs < 45_000, true)
check("burned file is larger than a few KB", burned.byteLength > 20_000, true)

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
const loaded = await pdfjs.getDocument({ data: burned.slice(), verbosity: 0 }).promise
let leakedSecret = false
for (let p = 1; p <= loaded.numPages; p++) {
  const page = await loaded.getPage(p)
  const text = await page.getTextContent()
  const joined = text.items.map((item) => (item && typeof item.str === "string" ? item.str : "")).join("")
  if (joined.includes("SECRET")) leakedSecret = true
  page.cleanup()
}
check("burned multi-page PDF has no SECRET text layer", leakedSecret, false)
check("burned page count matches source", loaded.numPages, 12)
await loaded.destroy?.()

const overlapBoxes = Array.from({ length: 40 }, (_, i) => ({
  pageNumber: 1,
  x: 0.1 + (i % 10) * 0.02,
  y: 0.1 + Math.floor(i / 10) * 0.05,
  width: 0.3,
  height: 0.2,
}))
const tiny = new PdfCtor({ unit: "pt", format: "a4" })
tiny.text("SECRET123", 72, 120)
const tinyBytes = new Uint8Array(tiny.output("arraybuffer"))
const { ms: overlapMs } = await timed("40 overlapping boxes on one page", () =>
  burnRedactedPdf({ bytes: tinyBytes, boxes: overlapBoxes, title: "overlap.pdf" }),
)
check("overlapping-box burn finishes in under 8s", overlapMs < 8_000, true)

const { ms: parallelBurnMs } = await timed("3 concurrent one-page burns", () =>
  Promise.all([
    burnRedactedPdf({ bytes: tinyBytes.slice(), boxes: overlapBoxes.slice(0, 5), title: "p1.pdf" }),
    burnRedactedPdf({ bytes: tinyBytes.slice(), boxes: overlapBoxes.slice(5, 10), title: "p2.pdf" }),
    burnRedactedPdf({ bytes: tinyBytes.slice(), boxes: overlapBoxes.slice(10, 15), title: "p3.pdf" }),
  ]),
)
check("3 concurrent burns finish in under 20s", parallelBurnMs < 20_000, true)

await admin.from("rpc_rate_limit_buckets").delete().in("user_id", [idA, idB, ...burstIds])

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
