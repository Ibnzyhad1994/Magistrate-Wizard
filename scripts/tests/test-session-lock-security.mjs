/**
 * Session-lock security properties: token drop, workspace retention,
 * failed local sign-out, overlay stacking, and residual in-memory data.
 *
 *   npm run test:session-lock
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProtectedRouteGate } from "@/lib/protected-route-gate";
import {
  AUTH_STORAGE_KEY,
  createAuthStorage,
  createMemoryStorage,
  setRememberMeFlag,
  readRememberPreference,
} from "@/lib/auth/session-storage";
import { useAuthStore } from "@/store/auth-store";
import { lockCurrentSession } from "@/lib/auth/session-lock";
import {
  completeSessionUnlock,
  finishPostUnlockReloadIfNeeded,
  recoverSessionWork,
  POST_UNLOCK_RELOAD_KEY,
} from "@/lib/auth/session-recovery";
import { currentProfileId, flushPendingHearings } from "@/lib/offline/runtime";
import {
  setCachedProfile,
  getCachedProfile,
  setOutboxJobs,
  getOutboxJobs,
  appendFailedJobs,
  getFailedJobs,
  clearOfflineForProfile,
} from "@/lib/offline/store";
import { queryClient } from "@/lib/query-client";
import {
  installSupabaseAuthMock,
  resetSupabaseAuthMock,
  getSupabaseAuthMockCalls,
} from "../test-support/supabase-stub.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "../../src");

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}

const profile = {
  id: "user-a",
  email: "magistrate@example.test",
  full_name: "Ada Magistrate",
  role: "magistrate",
};

const sessionFor = (userId, email) => ({
  access_token: `jwt-${userId}`,
  refresh_token: `refresh-${userId}`,
  user: { id: userId, email },
});

const authenticate = () => {
  useAuthStore.getState().reset();
  useAuthStore.setState({
    status: "authenticated",
    session: sessionFor("user-a", profile.email),
    user: { id: "user-a", email: profile.email },
    profile,
  });
};

{
  authenticate();
  useAuthStore.getState().lockSession();
  const state = useAuthStore.getState();
  check("lock drops the in-memory session", state.session, null);
  check("lock keeps status locked", state.status, "locked");
  check("lock keeps the user id", state.user?.id, "user-a");
  check("lock keeps the profile email", state.profile?.email, profile.email);
  check("lock keeps the profile role", state.profile?.role, "magistrate");
}

{
  authenticate();
  useAuthStore.getState().lockSession();
  useAuthStore.getState().lockSession();
  check("second lockSession is a no-op", useAuthStore.getState().status, "locked");
  check("second lockSession still has no session", useAuthStore.getState().session, null);
}

{
  useAuthStore.getState().reset();
  useAuthStore.getState().lockSession();
  check("lockSession ignores loading", useAuthStore.getState().status, "loading");
}

{
  authenticate();
  useAuthStore.getState().lockSession();
  useAuthStore.getState().setSession(null);
  const state = useAuthStore.getState();
  check("null session while locked does not bounce to login", state.status, "locked");
  check("null session while locked keeps the user", state.user?.id, "user-a");
  check("null session while locked keeps the profile", state.profile?.id, "user-a");
}

{
  authenticate();
  useAuthStore.getState().lockSession();
  useAuthStore.getState().setSession(sessionFor("user-b", "other@example.test"));
  const state = useAuthStore.getState();
  check("a new session while locked authenticates immediately", state.status, "authenticated");
  check(
    "unlock does not require the next user id to match the locked user",
    state.user?.id,
    "user-b",
  );
}

{
  authenticate();
  useAuthStore.getState().lockSession();
  useAuthStore.getState().clearForSignOut();
  const state = useAuthStore.getState();
  check("explicit sign-out from locked clears status", state.status, "unauthenticated");
  check("explicit sign-out from locked clears user", state.user, null);
  check("explicit sign-out from locked clears profile", state.profile, null);
}

{
  check(
    "locked workspace stays on the current route",
    resolveProtectedRouteGate({ status: "locked", profile: { role: "magistrate" } }),
    "ok",
  );
}

{
  const local = createMemoryStorage();
  const session = createMemoryStorage();
  const storage = createAuthStorage({ local, session, now: () => 1_000_000 });
  setRememberMeFlag(true, { local, now: 1_000_000 });
  storage.setItem(AUTH_STORAGE_KEY, '{"access_token":"remembered"}');
  storage.removeItem(AUTH_STORAGE_KEY);
  check(
    "local sign-out storage removeItem clears Remember-me tokens",
    local.getItem(AUTH_STORAGE_KEY),
    null,
  );
  check(
    "local sign-out storage removeItem clears session tokens",
    session.getItem(AUTH_STORAGE_KEY),
    null,
  );
  check(
    "local sign-out does not clear the Remember-me preference",
    readRememberPreference(local).rememberMe,
    true,
  );
}

{
  authenticate();
  installSupabaseAuthMock({
    signOut: async () => ({ error: null }),
  });
  await lockCurrentSession();
  const calls = getSupabaseAuthMockCalls();
  check("lockCurrentSession calls GoTrue local sign-out", calls[0]?.method, "signOut");
  check("lockCurrentSession uses scope local", calls[0]?.options, { scope: "local" });
  check("lockCurrentSession leaves status locked", useAuthStore.getState().status, "locked");
  check("lockCurrentSession drops the store session", useAuthStore.getState().session, null);
  resetSupabaseAuthMock();
}

{
  // Security-audit finding: the offline docket cache (case numbers,
  // matter titles, hearing detail) used to survive an idle-lock, clearing
  // only on an explicit sign-out -- leaving it readable via DevTools on a
  // shared terminal with no further authentication required.
  authenticate();
  await setCachedProfile("user-a", profile);
  check("offline cache holds the profile before locking", getCachedProfile("user-a")?.id, "user-a");
  installSupabaseAuthMock({ signOut: async () => ({ error: null }) });
  await lockCurrentSession();
  check(
    "lockCurrentSession clears the offline cache for the locked profile",
    getCachedProfile("user-a"),
    null,
  );
  resetSupabaseAuthMock();
}

{
  // Audit §7.7: the idle lock used to wipe the outbox along with the cache,
  // so hearings saved offline vanished before the post-unlock flush could
  // send them. A lock is not a sign-out: the queued work must survive it.
  authenticate();
  const queued = {
    kind: "create",
    id: "local:queued-1",
    matterId: "mat-1",
    payload: {
      scheduled_date: "2026-08-24",
      scheduled_time: null,
      event_type: null,
      location: null,
      stage_at_event: null,
      outcome_at_event: null,
      orders_made_at_event: null,
      notes: null,
      event_status: "scheduled",
    },
    caseNumber: "GEO-1",
    matterTitle: "Police v. Test",
  };
  await setOutboxJobs("user-a", [queued]);
  await appendFailedJobs("user-a", [
    {
      job: queued,
      reason: "conflict",
      message: "changed elsewhere",
      failedAt: "2026-08-24T00:00:00Z",
    },
  ]);
  await setCachedProfile("user-a", profile);
  installSupabaseAuthMock({ signOut: async () => ({ error: null }) });
  await lockCurrentSession();
  check("lockCurrentSession keeps the offline outbox", getOutboxJobs("user-a").length, 1);
  check(
    "lockCurrentSession keeps the queued job intact",
    getOutboxJobs("user-a")[0]?.id,
    "local:queued-1",
  );
  check("lockCurrentSession keeps the failed list", getFailedJobs("user-a").length, 1);
  check("lockCurrentSession still clears the cached profile", getCachedProfile("user-a"), null);
  await clearOfflineForProfile("user-a");
  check("explicit sign-out wipe still clears the outbox", getOutboxJobs("user-a"), []);
  check("explicit sign-out wipe still clears the failed list", getFailedJobs("user-a"), []);
  resetSupabaseAuthMock();
}

{
  authenticate();
  let signOuts = 0;
  installSupabaseAuthMock({
    signOut: async () => {
      signOuts += 1;
      return { error: null };
    },
  });
  await Promise.all([lockCurrentSession(), lockCurrentSession()]);
  check("concurrent lockCurrentSession coalesces to one local sign-out", signOuts, 1);
  resetSupabaseAuthMock();
}

{
  authenticate();
  installSupabaseAuthMock({
    signOut: async () => {
      throw new Error("storage quota");
    },
  });
  await lockCurrentSession();
  check(
    "failed local sign-out still marks the UI locked",
    useAuthStore.getState().status,
    "locked",
  );
  check(
    "failed local sign-out still drops the store session",
    useAuthStore.getState().session,
    null,
  );

  let retried = 0;
  installSupabaseAuthMock({
    signOut: async () => {
      retried += 1;
      return { error: null };
    },
  });
  await lockCurrentSession();
  check("already-locked lockCurrentSession retries a failed local sign-out", retried, 1);
  resetSupabaseAuthMock();
}

{
  useAuthStore.getState().reset();
  useAuthStore.setState({ status: "unauthenticated", session: null, user: null, profile: null });
  let signOuts = 0;
  installSupabaseAuthMock({
    signOut: async () => {
      signOuts += 1;
      return { error: null };
    },
  });
  await lockCurrentSession();
  check("lockCurrentSession ignores unauthenticated", signOuts, 0);
  resetSupabaseAuthMock();
}

{
  authenticate();
  queryClient.setQueryData(
    ["docket-matters", "list", ""],
    [{ id: "matter-1", case_number: "GEO-1" }],
  );
  useAuthStore.getState().lockSession();
  check(
    "lock does not clear the React Query cache",
    queryClient.getQueryData(["docket-matters", "list", ""])?.[0]?.case_number,
    "GEO-1",
  );
}

{
  authenticate();
  useAuthStore.getState().lockSession();
  const result = await flushPendingHearings();
  check("hearing flush is skipped while locked", result, { skipped: true });
}

{
  authenticate();
  useAuthStore.getState().lockSession();
  installSupabaseAuthMock({
    getSession: async () => ({ data: { session: { user: { id: "from-jwt" } } }, error: null }),
  });
  const id = await currentProfileId();
  check("locked currentProfileId still returns the retained user id", id, "user-a");
  resetSupabaseAuthMock();
}

{
  authenticate();
  queryClient.setQueryData(["bench-notes", "secret"], { body: "CANARY-BENCH" });
  useAuthStore.getState().lockSession();
  useAuthStore.getState().setSession(sessionFor("user-a", profile.email));
  installSupabaseAuthMock();
  await recoverSessionWork();
  check(
    "unlock recovery invalidates but does not wipe cached rows",
    queryClient.getQueryData(["bench-notes", "secret"])?.body,
    "CANARY-BENCH",
  );
  resetSupabaseAuthMock();
}

{
  const lockSource = readFileSync(join(SRC, "components/auth/session-lock-dialog.tsx"), "utf8");
  const tourSource = readFileSync(join(SRC, "components/tour/tour-overlay.tsx"), "utf8");
  const tourProvider = readFileSync(join(SRC, "components/tour/tour-provider.tsx"), "utf8");
  // Stacking tiers are named in tailwind.config.ts (z-lock, z-tour, ...);
  // resolve a class to its numeric value so the ordering stays asserted.
  const tailwindConfig = readFileSync(join(SRC, "..", "tailwind.config.ts"), "utf8");
  const zTier = (name) =>
    /^\d+$/.test(name) ? name : new RegExp(`\\b${name}:\\s*"(\\d+)"`).exec(tailwindConfig)?.[1];
  // Highest stacking class the file uses (arbitrary `z-[n]` or a named tier).
  const zOf = (source) => {
    const values = [...source.matchAll(/\bz-(?:\[(\d+)\]|([a-z]+))\b/g)]
      .map((m) => zTier(m[1] ?? m[2]))
      .filter(Boolean)
      .map(Number);
    return values.length ? String(Math.max(...values)) : undefined;
  };
  const lockZ = zOf(lockSource);
  const tourZ = zOf(tourSource);
  check("lock dialog declares a stacking z-index", Boolean(lockZ), true);
  check("tour overlay declares a stacking z-index", Boolean(tourZ), true);
  check("lock dialog stacks above the tour overlay", Number(lockZ) > Number(tourZ), true);
  check(
    "walkthrough stops when the session is locked",
    tourProvider.includes('status === "locked"') && tourProvider.includes("handleStop(false)"),
    true,
  );
}

{
  const lifecycle = readFileSync(join(SRC, "components/auth/session-lifecycle.tsx"), "utf8");
  check(
    "DEV lock helper is gated on import.meta.env.DEV",
    lifecycle.includes("if (!import.meta.env.DEV) return"),
    true,
  );
  check(
    "idle clock only ticks while authenticated",
    lifecycle.includes('if (useAuthStore.getState().status !== "authenticated") return'),
    true,
  );
}

{
  const dialog = readFileSync(join(SRC, "components/auth/session-lock-dialog.tsx"), "utf8");
  check("lock dialog stays open", dialog.includes("<Dialog open>"), true);
  check("lock dialog hides the close button", dialog.includes("hideCloseButton"), true);
  check("lock dialog blocks outside pointer", dialog.includes("onPointerDownOutside"), true);
  check("lock dialog blocks escape", dialog.includes("onEscapeKeyDown"), true);
  check("lock email field is read-only", dialog.includes("readOnly"), true);
  check(
    "reauthenticate uses hook email, not a typed email",
    /reauthenticate\(password\)/.test(dialog),
    true,
  );
  check(
    "lock dialog tells the user queued work saves then the page reloads",
    dialog.replace(/\s+/g, " ").includes("Your saves will sync") &&
      dialog.replace(/\s+/g, " ").includes("the page reloads"),
    true,
  );
  check(
    "lock dialog uses the shared password reveal field",
    dialog.includes("<PasswordInput"),
    true,
  );
  check(
    "lock dialog can send a reset without leaving",
    dialog.includes("resetPassword(email)"),
    true,
  );
  check(
    "forgot-password from lock does not navigate away",
    dialog.includes("ROUTES.forgotPassword"),
    false,
  );
  check(
    "lock dialog tells the user to finish reset in another tab",
    dialog.includes("open the link in a new tab") && dialog.includes("Keep this window open"),
    true,
  );
  const passwordInput = readFileSync(join(SRC, "components/auth/password-input.tsx"), "utf8");
  check(
    "password reveal toggles the input type",
    passwordInput.includes('type={visible ? "text" : "password"}'),
    true,
  );
  check(
    "password reveal control cannot submit a form",
    passwordInput.includes('type="button"') && passwordInput.includes("Show password"),
    true,
  );
}

{
  const hook = readFileSync(join(SRC, "hooks/use-auth.ts"), "utf8");
  check(
    "isAuthenticated includes locked so the workspace stays mounted",
    hook.includes('isAuthenticated: status === "authenticated" || status === "locked"'),
    true,
  );
  check(
    "reauthenticate signs in as the locked email, not a form email",
    hook.includes("const email = user?.email ?? profile?.email"),
    true,
  );
  check(
    "reauthenticate does not compare the returned user id to the locked user",
    !/data\.user\.id|session\.user\.id/.test(
      hook.split("reauthenticateMutation")[1]?.split("signUpMutation")[0] ?? "",
    ),
    true,
  );
}

{
  const provider = readFileSync(join(SRC, "providers/auth-provider.tsx"), "utf8");
  check(
    "SIGNED_OUT while locked does not wipe the profile",
    provider.includes('if (useAuthStore.getState().status === "locked") return'),
    true,
  );
  check(
    "token refresh while locked does not restore the session",
    provider.includes('status === "locked" && event !== "SIGNED_IN"'),
    true,
  );
}

{
  const recovery = readFileSync(join(SRC, "lib/auth/session-recovery.ts"), "utf8");
  check(
    "recovery still leaves the in-memory query cache in place until reload",
    recovery.includes("Does not wipe the in-memory query cache"),
    true,
  );
  check(
    "unlock reloads after saving queued work",
    recovery.includes("completeSessionUnlock") && recovery.includes("reloadPage"),
    true,
  );
}

{
  const memory = new Map();
  const storage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => {
      memory.set(key, value);
    },
    removeItem: (key) => {
      memory.delete(key);
    },
  };
  let reloads = 0;
  authenticate();
  queryClient.setQueryData(["bench-notes", "secret"], { body: "CANARY-BENCH" });
  installSupabaseAuthMock();
  await completeSessionUnlock({
    reloadPage: () => {
      reloads += 1;
    },
    storage,
  });
  check("first unlock save-then-refresh reloads once", reloads, 1);
  check("first unlock marks a pending reload", storage.getItem(POST_UNLOCK_RELOAD_KEY), "pending");
  const finished = await finishPostUnlockReloadIfNeeded({ storage });
  check("reloaded tab finishes queued work without a second reload", finished, true);
  check(
    "pending reload flag is cleared after finish",
    storage.getItem(POST_UNLOCK_RELOAD_KEY),
    null,
  );
  reloads = 0;
  await completeSessionUnlock({
    reloadPage: () => {
      reloads += 1;
    },
    storage,
  });
  check("a later unlock with no pending flag still reloads", reloads, 1);
  resetSupabaseAuthMock();
}

{
  const lifecycle = readFileSync(join(SRC, "components/auth/session-lifecycle.tsx"), "utf8");
  check("idle unlock saves then reloads", lifecycle.includes("completeSessionUnlock"), true);
  check(
    "reloaded tab consumes the pending reload flag",
    lifecycle.includes("finishPostUnlockReloadIfNeeded"),
    true,
  );
}

queryClient.clear();
useAuthStore.getState().reset();
resetSupabaseAuthMock();

if (failures > 0) {
  console.error(`\n${failures} session-lock security checks failed`);
  process.exit(1);
}
console.log("\nAll session-lock security checks passed");
