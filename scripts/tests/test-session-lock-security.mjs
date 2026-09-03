/**
 * Session-lock security properties: token drop, workspace retention,
 * failed local sign-out, overlay stacking, and residual in-memory data.
 *
 *   npm run test:session-lock
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveProtectedRouteGate } from "@/lib/protected-route-gate"
import { AUTH_STORAGE_KEY, createAuthStorage, createMemoryStorage, setRememberMeFlag, readRememberPreference } from "@/lib/auth/session-storage"
import { useAuthStore } from "@/store/auth-store"
import { lockCurrentSession } from "@/lib/auth/session-lock"
import { recoverSessionWork } from "@/lib/auth/session-recovery"
import { currentProfileId, flushPendingHearings } from "@/lib/offline/runtime"
import { queryClient } from "@/lib/query-client"
import {
  installSupabaseAuthMock,
  resetSupabaseAuthMock,
  getSupabaseAuthMockCalls,
} from "../test-support/supabase-stub.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, "../../src")

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

const profile = {
  id: "user-a",
  email: "magistrate@example.test",
  full_name: "Ada Magistrate",
  role: "magistrate",
}

const sessionFor = (userId, email) => ({
  access_token: `jwt-${userId}`,
  refresh_token: `refresh-${userId}`,
  user: { id: userId, email },
})

const authenticate = () => {
  useAuthStore.getState().reset()
  useAuthStore.setState({
    status: "authenticated",
    session: sessionFor("user-a", profile.email),
    user: { id: "user-a", email: profile.email },
    profile,
  })
}

{
  authenticate()
  useAuthStore.getState().lockSession()
  const state = useAuthStore.getState()
  check("lock drops the in-memory session", state.session, null)
  check("lock keeps status locked", state.status, "locked")
  check("lock keeps the user id", state.user?.id, "user-a")
  check("lock keeps the profile email", state.profile?.email, profile.email)
  check("lock keeps the profile role", state.profile?.role, "magistrate")
}

{
  authenticate()
  useAuthStore.getState().lockSession()
  useAuthStore.getState().lockSession()
  check("second lockSession is a no-op", useAuthStore.getState().status, "locked")
  check("second lockSession still has no session", useAuthStore.getState().session, null)
}

{
  useAuthStore.getState().reset()
  useAuthStore.getState().lockSession()
  check("lockSession ignores loading", useAuthStore.getState().status, "loading")
}

{
  authenticate()
  useAuthStore.getState().lockSession()
  useAuthStore.getState().setSession(null)
  const state = useAuthStore.getState()
  check("null session while locked does not bounce to login", state.status, "locked")
  check("null session while locked keeps the user", state.user?.id, "user-a")
  check("null session while locked keeps the profile", state.profile?.id, "user-a")
}

{
  authenticate()
  useAuthStore.getState().lockSession()
  useAuthStore.getState().setSession(sessionFor("user-b", "other@example.test"))
  const state = useAuthStore.getState()
  check("a new session while locked authenticates immediately", state.status, "authenticated")
  check(
    "unlock does not require the next user id to match the locked user",
    state.user?.id,
    "user-b",
  )
}

{
  authenticate()
  useAuthStore.getState().lockSession()
  useAuthStore.getState().clearForSignOut()
  const state = useAuthStore.getState()
  check("explicit sign-out from locked clears status", state.status, "unauthenticated")
  check("explicit sign-out from locked clears user", state.user, null)
  check("explicit sign-out from locked clears profile", state.profile, null)
}

{
  check(
    "locked workspace stays on the current route",
    resolveProtectedRouteGate({ status: "locked", profile: { role: "magistrate" } }),
    "ok",
  )
}

{
  const local = createMemoryStorage()
  const session = createMemoryStorage()
  const storage = createAuthStorage({ local, session, now: () => 1_000_000 })
  setRememberMeFlag(true, { local, now: 1_000_000 })
  storage.setItem(AUTH_STORAGE_KEY, '{"access_token":"remembered"}')
  storage.removeItem(AUTH_STORAGE_KEY)
  check("local sign-out storage removeItem clears Remember-me tokens", local.getItem(AUTH_STORAGE_KEY), null)
  check("local sign-out storage removeItem clears session tokens", session.getItem(AUTH_STORAGE_KEY), null)
  check(
    "local sign-out does not clear the Remember-me preference",
    readRememberPreference(local).rememberMe,
    true,
  )
}

{
  authenticate()
  installSupabaseAuthMock({
    signOut: async () => ({ error: null }),
  })
  await lockCurrentSession()
  const calls = getSupabaseAuthMockCalls()
  check("lockCurrentSession calls GoTrue local sign-out", calls[0]?.method, "signOut")
  check("lockCurrentSession uses scope local", calls[0]?.options, { scope: "local" })
  check("lockCurrentSession leaves status locked", useAuthStore.getState().status, "locked")
  check("lockCurrentSession drops the store session", useAuthStore.getState().session, null)
  resetSupabaseAuthMock()
}

{
  authenticate()
  let signOuts = 0
  installSupabaseAuthMock({
    signOut: async () => {
      signOuts += 1
      return { error: null }
    },
  })
  await Promise.all([lockCurrentSession(), lockCurrentSession()])
  check("concurrent lockCurrentSession coalesces to one local sign-out", signOuts, 1)
  resetSupabaseAuthMock()
}

{
  authenticate()
  installSupabaseAuthMock({
    signOut: async () => {
      throw new Error("storage quota")
    },
  })
  await lockCurrentSession()
  check("failed local sign-out still marks the UI locked", useAuthStore.getState().status, "locked")
  check("failed local sign-out still drops the store session", useAuthStore.getState().session, null)

  let retried = 0
  installSupabaseAuthMock({
    signOut: async () => {
      retried += 1
      return { error: null }
    },
  })
  await lockCurrentSession()
  check(
    "already-locked lockCurrentSession retries a failed local sign-out",
    retried,
    1,
  )
  resetSupabaseAuthMock()
}

{
  useAuthStore.getState().reset()
  useAuthStore.setState({ status: "unauthenticated", session: null, user: null, profile: null })
  let signOuts = 0
  installSupabaseAuthMock({
    signOut: async () => {
      signOuts += 1
      return { error: null }
    },
  })
  await lockCurrentSession()
  check("lockCurrentSession ignores unauthenticated", signOuts, 0)
  resetSupabaseAuthMock()
}

{
  authenticate()
  queryClient.setQueryData(["docket-matters", "list", ""], [{ id: "matter-1", case_number: "GEO-1" }])
  useAuthStore.getState().lockSession()
  check(
    "lock does not clear the React Query cache",
    queryClient.getQueryData(["docket-matters", "list", ""])?.[0]?.case_number,
    "GEO-1",
  )
}

{
  authenticate()
  useAuthStore.getState().lockSession()
  const result = await flushPendingHearings()
  check("hearing flush is skipped while locked", result, { skipped: true })
}

{
  authenticate()
  useAuthStore.getState().lockSession()
  installSupabaseAuthMock({
    getSession: async () => ({ data: { session: { user: { id: "from-jwt" } } }, error: null }),
  })
  const id = await currentProfileId()
  check("locked currentProfileId still returns the retained user id", id, "user-a")
  resetSupabaseAuthMock()
}

{
  authenticate()
  queryClient.setQueryData(["bench-notes", "secret"], { body: "CANARY-BENCH" })
  useAuthStore.getState().lockSession()
  useAuthStore.getState().setSession(sessionFor("user-a", profile.email))
  installSupabaseAuthMock()
  await recoverSessionWork()
  check(
    "unlock recovery invalidates but does not wipe cached rows",
    queryClient.getQueryData(["bench-notes", "secret"])?.body,
    "CANARY-BENCH",
  )
  resetSupabaseAuthMock()
}

{
  const lockSource = readFileSync(join(SRC, "components/auth/session-lock-dialog.tsx"), "utf8")
  const tourSource = readFileSync(join(SRC, "components/tour/tour-overlay.tsx"), "utf8")
  const tourProvider = readFileSync(join(SRC, "components/tour/tour-provider.tsx"), "utf8")
  const lockZ = /z-\[(\d+)\]/.exec(lockSource)?.[1]
  const tourZ = /z-\[(\d+)\]/.exec(tourSource)?.[1]
  check("lock dialog declares a stacking z-index", Boolean(lockZ), true)
  check("tour overlay declares a stacking z-index", Boolean(tourZ), true)
  check(
    "lock dialog stacks above the tour overlay",
    Number(lockZ) > Number(tourZ),
    true,
  )
  check(
    "walkthrough stops when the session is locked",
    tourProvider.includes('status === "locked"') && tourProvider.includes("handleStop(false)"),
    true,
  )
}

{
  const lifecycle = readFileSync(join(SRC, "components/auth/session-lifecycle.tsx"), "utf8")
  check(
    "DEV lock helper is gated on import.meta.env.DEV",
    lifecycle.includes("if (!import.meta.env.DEV) return"),
    true,
  )
  check(
    "idle clock only ticks while authenticated",
    lifecycle.includes('if (useAuthStore.getState().status !== "authenticated") return'),
    true,
  )
}

{
  const dialog = readFileSync(join(SRC, "components/auth/session-lock-dialog.tsx"), "utf8")
  check("lock dialog stays open", dialog.includes("<Dialog open>"), true)
  check("lock dialog hides the close button", dialog.includes("hideCloseButton"), true)
  check("lock dialog blocks outside pointer", dialog.includes("onPointerDownOutside"), true)
  check("lock dialog blocks escape", dialog.includes("onEscapeKeyDown"), true)
  check("lock email field is read-only", dialog.includes("readOnly"), true)
  check("reauthenticate uses hook email, not a typed email", /reauthenticate\(password\)/.test(dialog), true)
}

{
  const hook = readFileSync(join(SRC, "hooks/use-auth.ts"), "utf8")
  check(
    "isAuthenticated includes locked so the workspace stays mounted",
    hook.includes('isAuthenticated: status === "authenticated" || status === "locked"'),
    true,
  )
  check(
    "reauthenticate signs in as the locked email, not a form email",
    hook.includes("const email = user?.email ?? profile?.email"),
    true,
  )
  check(
    "reauthenticate does not compare the returned user id to the locked user",
    !/data\.user\.id|session\.user\.id/.test(hook.split("reauthenticateMutation")[1]?.split("signUpMutation")[0] ?? ""),
    true,
  )
}

{
  const provider = readFileSync(join(SRC, "providers/auth-provider.tsx"), "utf8")
  check(
    "SIGNED_OUT while locked does not wipe the profile",
    provider.includes('if (useAuthStore.getState().status === "locked") return'),
    true,
  )
}

{
  const recovery = readFileSync(join(SRC, "lib/auth/session-recovery.ts"), "utf8")
  check(
    "recovery documents that only Sign out clears the query cache",
    recovery.includes("Query cache is not cleared"),
    true,
  )
}

queryClient.clear()
useAuthStore.getState().reset()
resetSupabaseAuthMock()

if (failures > 0) {
  console.error(`\n${failures} session-lock security checks failed`)
  process.exit(1)
}
console.log("\nAll session-lock security checks passed")
