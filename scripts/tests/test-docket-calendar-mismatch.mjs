/**
 * Live local check that a 9 Sep sitting at Vigilance still counts on the
 * calendar when Docket is headed Kamarang, and that listing All My Courts
 * for that day returns 2053/26 even with a leftover No-date chip.
 *
 * Needs local Supabase with seed.sql applied (`npx supabase db reset`).
 * Not part of develop-ci.
 *
 *   npm run test:docket-calendar-mismatch
 */
import { createClient } from "@supabase/supabase-js"
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs"

// Deliberately NO fallback to the .env FILE. That file holds the PRODUCTION
// project URL, so reading it here meant `npm run test:docket-calendar-mismatch`
// quietly sent a password login for a fixture account to production Auth and
// then reported "confirm local Supabase is running" — pointing the reader at
// their laptop while the request went to the live system. Env var, then local.
const URL_ = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321"
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"

assertLocalSupabase(URL_, "test:docket-calendar-mismatch")

const EMAIL = "calendar@magistrate-wizard.local"
const PASSWORD = "password123"
const SITTING_DATE = "2026-09-09"
const CASE_NUMBER = "2053/26"

let failures = 0
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`)
  if (!condition) failures += 1
}

const client = createClient(URL_, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { error: signInError } = await client.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD,
})
if (signInError) {
  console.error(
    "Could not sign in as calendar@magistrate-wizard.local. Apply supabase/seed.sql (`npx supabase db reset`) and confirm local Supabase is running.",
  )
  console.error(signInError.message)
  process.exit(1)
}

const { data: courts, error: courtsError } = await client.from("courts").select("id, name")
if (courtsError) throw courtsError
const kamarang = courts.find((c) => c.name === "Kamarang Magistrate's Court")
const vigilance = courts.find((c) => c.name === "Vigilance Magistrates' Court 1")
check("persona can read Kamarang Magistrate's Court", !!kamarang)
check("persona can read Vigilance Magistrates' Court 1", !!vigilance)

const { data: snapshot, error: snapError } = await client.rpc("get_docket_capacity_snapshot", {
  p_scheduled_date: SITTING_DATE,
})
check("all-courts snapshot RPC succeeds", !snapError)
if (snapError) console.error("  ", snapError.message)
const trialRow = (snapshot ?? []).find((row) => row.category_name === "Criminal trial")
check(
  "snapshot for 2026-09-09 with null court is 1 on Criminal trial",
  Number(trialRow?.scheduled_count) === 1 && Number(trialRow?.daily_capacity) === 10,
)

const { data: kamarangList, error: kamarangErr } = await client.rpc("list_docket_matters", {
  p_exact_date: SITTING_DATE,
  p_court_id: kamarang?.id,
})
check("list with Kamarang + that date succeeds", !kamarangErr)
check(
  "list with Kamarang + that date is empty (the sitting is at Vigilance)",
  Array.isArray(kamarangList) && kamarangList.length === 0,
)

const { data: allCourtsList, error: allErr } = await client.rpc("list_docket_matters", {
  p_exact_date: SITTING_DATE,
})
check("list with null court + that date succeeds", !allErr)
check(
  "list with null court + that date returns 2053/26",
  (allCourtsList ?? []).some((row) => row.case_number === CASE_NUMBER),
)

const { data: noDateList, error: noDateErr } = await client.rpc("list_docket_matters", {
  p_exact_date: SITTING_DATE,
  p_court_id: vigilance?.id,
  p_next_date: ["no_date"],
})
check("list with Vigilance + date + no_date succeeds", !noDateErr)
check(
  "list with Vigilance + date + no_date still returns 2053/26",
  (noDateList ?? []).some((row) => row.case_number === CASE_NUMBER),
)

await client.auth.signOut({ scope: "local" })
client.realtime.disconnect()

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
