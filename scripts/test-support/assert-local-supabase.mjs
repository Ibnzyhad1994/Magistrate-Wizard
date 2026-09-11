/**
 * Refuse to run a destructive/live-DB test against a remote Supabase project
 * unless the operator says so explicitly.
 *
 * These harnesses sign in as fixture accounts, and some of them create users
 * and seed canary rows. Several resolved their URL from an env var (or, in one
 * case, from the .env FILE, which holds the production project) and then
 * reported a misleading "is local Supabase running?" when the fixture account
 * predictably did not exist there — so a run aimed at production looked exactly
 * like a run against a stopped local stack.
 *
 * Localhost passes silently. Anything else aborts with the host named, unless
 * ALLOW_REMOTE_SUPABASE=1 is set — the pentest harness is documented as usable
 * against a staging project you own, so this is an explicit acknowledgement
 * rather than a hard block.
 */

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0", "::1", "[::1]", "host.docker.internal"])

export function isLocalSupabaseUrl(rawUrl) {
  let host
  try {
    host = new URL(rawUrl).hostname
  } catch {
    return false
  }
  return LOCAL_HOSTS.has(host)
}

export function assertLocalSupabase(rawUrl, testName = "this test") {
  if (isLocalSupabaseUrl(rawUrl)) return
  if (process.env.ALLOW_REMOTE_SUPABASE === "1") {
    console.warn(
      `WARNING: ${testName} is running against a REMOTE Supabase project (${rawUrl}) ` +
        `because ALLOW_REMOTE_SUPABASE=1 is set.`,
    )
    return
  }
  console.error(
    `\nRefusing to run ${testName} against a non-local Supabase project.\n` +
      `  Resolved URL: ${rawUrl}\n\n` +
      `This harness signs in as fixture accounts and may write data, so it must not\n` +
      `point at production or staging by accident. Either start local Supabase\n` +
      `(\`npm run db:start && npm run db:reset\`) and unset VITE_SUPABASE_URL, or set\n` +
      `ALLOW_REMOTE_SUPABASE=1 if you genuinely intend to target that project.\n`,
  )
  process.exit(2)
}
