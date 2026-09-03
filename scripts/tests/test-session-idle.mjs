import {
  evaluateSessionIdle,
  idlePhaseAfterRestore,
  isRememberExpired,
  pathFromLoginRedirect,
  rememberUntilFrom,
  resolveIdleTimeoutMs,
  DEFAULT_IDLE_MS,
  REMEMBER_MS,
  WARN_BEFORE_MS,
} from "@/lib/auth/session-policy"
import {
  AUTH_STORAGE_KEY,
  createAuthStorage,
  createMemoryStorage,
  prepareAuthStorage,
  readRememberPreference,
  REMEMBER_PREFERENCE_KEY,
  setRememberMeFlag,
} from "@/lib/auth/session-storage"

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

const hour = DEFAULT_IDLE_MS
const t0 = 1_000_000

check("activity within the hour stays ok", evaluateSessionIdle({ lastActivityAt: t0, now: t0 + hour - WARN_BEFORE_MS - 1 }), "ok")
check(
  "warn at 55 minutes idle",
  evaluateSessionIdle({ lastActivityAt: t0, now: t0 + hour - WARN_BEFORE_MS }),
  "warn",
)
check("lock at 60 minutes idle", evaluateSessionIdle({ lastActivityAt: t0, now: t0 + hour }), "lock")
check(
  "activity resets the clock",
  evaluateSessionIdle({ lastActivityAt: t0 + hour - 1_000, now: t0 + hour }),
  "ok",
)
check(
  "hidden tab that sat idle for an hour locks on return",
  evaluateSessionIdle({ lastActivityAt: t0, now: t0 + hour + 5_000 }),
  "lock",
)
check(
  "Remember me overnight restore does not lock",
  idlePhaseAfterRestore({ rememberMe: true, lastActivityAt: null, now: t0 + 12 * hour }),
  "ok",
)
check(
  "open-tab idle still locks even with Remember me",
  idlePhaseAfterRestore({
    rememberMe: true,
    lastActivityAt: t0,
    now: t0 + hour,
  }),
  "lock",
)

check("default idle env is 1 hour", resolveIdleTimeoutMs(undefined), hour)
check("QA override 15s", resolveIdleTimeoutMs("15000"), 15_000)
check("junk env falls back to 1 hour", resolveIdleTimeoutMs("nope"), hour)

check("14-day rememberUntil is in the future", rememberUntilFrom(t0) > t0, true)
check("rememberUntil span is 14 days", rememberUntilFrom(t0) - t0, REMEMBER_MS)
check("rememberUntil not expired at the boundary", isRememberExpired(t0 + REMEMBER_MS, t0 + REMEMBER_MS), false)
check("rememberUntil expired after 14 days", isRememberExpired(t0 + REMEMBER_MS, t0 + REMEMBER_MS + 1), true)

check("login from restores path+search+hash", pathFromLoginRedirect({
  pathname: "/docket/abc",
  search: "?court=1",
  hash: "#notes",
}, "/dashboard"), "/docket/abc?court=1#notes")
check("protocol-relative from is rejected", pathFromLoginRedirect({ pathname: "//evil.example" }, "/dashboard"), "/dashboard")
check("missing from uses fallback", pathFromLoginRedirect(null, "/dashboard"), "/dashboard")

{
  const local = createMemoryStorage()
  const session = createMemoryStorage()
  local.setItem(AUTH_STORAGE_KEY, '{"access_token":"legacy"}')
  prepareAuthStorage({ local, session, now: t0 })
  check("legacy localStorage session moves to sessionStorage", session.getItem(AUTH_STORAGE_KEY), '{"access_token":"legacy"}')
  check("legacy localStorage auth key is stripped", local.getItem(AUTH_STORAGE_KEY), null)
  check("legacy preference is not Remember me", readRememberPreference(local).rememberMe, false)
}

{
  const local = createMemoryStorage()
  const session = createMemoryStorage()
  const storage = createAuthStorage({ local, session, now: () => t0 })
  setRememberMeFlag(true, { local, now: t0 })
  storage.setItem(AUTH_STORAGE_KEY, '{"access_token":"kept"}')
  check("Remember me writes localStorage", local.getItem(AUTH_STORAGE_KEY), '{"access_token":"kept"}')
  check("Remember me strips sessionStorage", session.getItem(AUTH_STORAGE_KEY), null)
}

{
  const local = createMemoryStorage()
  const session = createMemoryStorage()
  const storage = createAuthStorage({ local, session, now: () => t0 })
  setRememberMeFlag(false, { local, now: t0 })
  storage.setItem(AUTH_STORAGE_KEY, '{"access_token":"tab"}')
  check("session-only writes sessionStorage", session.getItem(AUTH_STORAGE_KEY), '{"access_token":"tab"}')
  check("session-only strips localStorage auth", local.getItem(AUTH_STORAGE_KEY), null)
}

{
  const local = createMemoryStorage()
  const session = createMemoryStorage()
  setRememberMeFlag(true, { local, now: t0, rememberMs: REMEMBER_MS })
  local.setItem(AUTH_STORAGE_KEY, '{"access_token":"stale"}')
  local.setItem(
    REMEMBER_PREFERENCE_KEY,
    JSON.stringify({ rememberMe: true, rememberUntil: t0 }),
  )
  prepareAuthStorage({ local, session, now: t0 + 1 })
  check("14-day expiry clears local auth", local.getItem(AUTH_STORAGE_KEY), null)
  check("14-day expiry clears session auth", session.getItem(AUTH_STORAGE_KEY), null)
  check("14-day expiry turns Remember me off", readRememberPreference(local).rememberMe, false)
}

{
  const local = createMemoryStorage()
  const session = createMemoryStorage()
  const storage = createAuthStorage({ local, session, now: () => t0 })
  setRememberMeFlag(true, { local, now: t0 })
  storage.setItem(AUTH_STORAGE_KEY, '{"access_token":"a"}')
  storage.removeItem(AUTH_STORAGE_KEY)
  check("removeItem clears local", local.getItem(AUTH_STORAGE_KEY), null)
  check("removeItem clears session", session.getItem(AUTH_STORAGE_KEY), null)
}

if (failures > 0) {
  console.error(`${failures} session idle checks failed`)
  process.exit(1)
}
console.log("All session idle checks passed")
