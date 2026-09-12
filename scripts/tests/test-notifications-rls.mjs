/**
 * Live RLS for the notification capabilities added in 0143 (dismiss) and
 * exposed from 0123 (mark-unread).
 *
 * Dismiss is a DELETE policy on a table whose rows are written by DEFINER
 * triggers — the thing that must be true is that it only ever reaches the
 * caller's own rows. That cannot be established by reading the policy text;
 * it needs two real sessions.
 *
 *   npm run test:notifications-rls   (local Supabase must be running)
 */
import { createClient } from "@supabase/supabase-js"
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs"

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321"
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

assertLocalSupabase(URL, "test:notifications-rls")

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

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })
const anon = createClient(URL, ANON, { auth: { persistSession: false } })

const signIn = async (email) => {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: "password123" })
  if (error) throw new Error(`Could not sign in ${email}: ${error.message}. Run npm run db:reset.`)
  return {
    id: data.user.id,
    client: createClient(URL, ANON, {
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
      auth: { persistSession: false },
    }),
  }
}

const owner = await signIn("magistrate@magistrate-wizard.local")
const other = await signIn("admin@magistrate-wizard.local")

// notify_user() is DEFINER-only and revoked from authenticated, so seed via
// service role — which is exactly how a trigger would have written it.
const seed = async (userId, title) => {
  const { data, error } = await admin
    .from("notifications")
    .insert({ user_id: userId, type: "court_assigned", title, body: "fixture", link: null })
    .select()
    .single()
  if (error) throw error
  return data
}

const created = []
try {
  // --- dismiss is scoped to your own rows ---------------------------------
  const mine = await seed(owner.id, "RLS fixture: owner")
  created.push(mine.id)

  const theirs = await seed(other.id, "RLS fixture: other user")
  created.push(theirs.id)

  // An attempt on someone else's row must remove nothing. PostgREST reports
  // a no-op delete as success with zero rows, so assert on what survives
  // rather than on the absence of an error.
  await owner.client.from("notifications").delete().eq("id", theirs.id)
  const { data: survived } = await admin
    .from("notifications")
    .select("id")
    .eq("id", theirs.id)
    .maybeSingle()
  check("a user cannot dismiss another user's notification", Boolean(survived), true)

  await owner.client.from("notifications").delete().eq("id", mine.id)
  const { data: gone } = await admin
    .from("notifications")
    .select("id")
    .eq("id", mine.id)
    .maybeSingle()
  check("a user can dismiss their own notification", gone, null)

  // --- mark read, then unread --------------------------------------------
  const toggling = await seed(owner.id, "RLS fixture: read toggle")
  created.push(toggling.id)

  await owner.client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", toggling.id)
  const { data: afterRead } = await admin
    .from("notifications")
    .select("read_at")
    .eq("id", toggling.id)
    .single()
  check("a user can mark their own notification read", afterRead.read_at !== null, true)

  await owner.client.from("notifications").update({ read_at: null }).eq("id", toggling.id)
  const { data: afterUnread } = await admin
    .from("notifications")
    .select("read_at")
    .eq("id", toggling.id)
    .single()
  check("a user can put it back to unread (no migration needed)", afterUnread.read_at, null)

  // --- immutability still holds ------------------------------------------
  // The whole point of allowing read_at through is that nothing else gets
  // through with it.
  const { error: titleErr } = await owner.client
    .from("notifications")
    .update({ title: "rewritten by recipient" })
    .eq("id", toggling.id)
  check("a user still cannot rewrite the title", Boolean(titleErr), true)

  const { error: typeErr } = await owner.client
    .from("notifications")
    .update({ type: "share_granted" })
    .eq("id", toggling.id)
  check("a user still cannot rewrite the type", Boolean(typeErr), true)

  const { error: insertErr } = await owner.client
    .from("notifications")
    .insert({ user_id: owner.id, type: "court_assigned", title: "self-inserted" })
  check("a user still cannot insert a notification for themselves", Boolean(insertErr), true)

  // --- and cannot read another user's ------------------------------------
  const { data: peek } = await owner.client.from("notifications").select("id").eq("id", theirs.id)
  check("a user cannot read another user's notification", peek ?? [], [])
} finally {
  for (const id of created) {
    await admin.from("notifications").delete().eq("id", id)
  }
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
