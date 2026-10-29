// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * BE-27 against the running local stack: a password reset completes through
 * the PKCE code exchange, and no access or refresh token is ever in a URL.
 *
 * Asks for a reset with a PKCE client (as the app does), reads the email
 * from the stack's own mail catcher (never a real mailbox), follows the
 * link to Auth's verify endpoint without following its redirect, and
 * checks the redirect carries only a one-time ?code=. Then it lands that
 * URL through the app's own parsing (auth-redirect.ts), exchanges the code
 * with the stored verifier, checks the session is told apart as a recovery
 * session, sets a new password and signs in with it. A disposable account,
 * deleted at the end.
 *
 *   npm run test:auth-pkce-reset-live
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";
import {
  isRecoveryAccessToken,
  readAuthCallback,
  urlWithoutAuthCallback,
} from "../../src/lib/auth/auth-redirect.ts";
import {
  AUTH_STORAGE_KEY,
  createAuthStorage,
  createMemoryStorage,
  setRememberMeFlag,
} from "../../src/lib/auth/session-storage.ts";

const URL_ = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
// The stack's mail catcher ([inbucket] port in supabase/config.toml).
const MAIL_URL = process.env.SUPABASE_MAIL_URL ?? "http://127.0.0.1:56324";
// The app's site_url; GoTrue accepts any path on it as a redirect.
const APP_ORIGIN = "http://127.0.0.1:5373";
assertLocalSupabase(URL_, "test:auth-pkce-reset-live");
assertLocalSupabase(MAIL_URL, "test:auth-pkce-reset-live");

const STAMP = Date.now().toString(36);
const EMAIL = `pkce-reset-${STAMP}@magistrate-wizard.local`;
const OLD_PASSWORD = "Pkce-fixture-pass-123!";
const NEW_PASSWORD = "Pkce-fixture-pass-456?";

const admin = createClient(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});
/**
 * A tab of a browser, its client configured like src/lib/supabase.ts: the
 * app's own auth storage over that browser's localStorage and the tab's
 * own sessionStorage. Without a browser, a browser of its own.
 */
const pkceClient = (browserLocal = createMemoryStorage()) =>
  createClient(URL_, ANON, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: false,
      storageKey: AUTH_STORAGE_KEY,
      storage: createAuthStorage({ local: browserLocal, session: createMemoryStorage() }),
    },
  });

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}

const hasToken = (text) => /access_token|refresh_token/.test(text);

/**
 * The newest email to `to`, as { html, text }. Mailpit (current CLI) first,
 * then the older Inbucket API, polled until it arrives.
 */
async function waitForEmail(to, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await fetch(`${MAIL_URL}/api/v1/messages?limit=50`).catch(() => null);
    if (list?.ok) {
      const { messages = [] } = await list.json();
      const hit = messages.find((m) => (m.To ?? []).some((r) => r.Address === to));
      if (hit) {
        const message = await (await fetch(`${MAIL_URL}/api/v1/message/${hit.ID}`)).json();
        return { html: message.HTML ?? "", text: message.Text ?? "" };
      }
    } else {
      const mailbox = to.split("@")[0];
      const inbox = await fetch(`${MAIL_URL}/api/v1/mailbox/${mailbox}`).catch(() => null);
      if (inbox?.ok) {
        const messages = await inbox.json();
        const last = messages.at(-1);
        if (last) {
          const message = await (
            await fetch(`${MAIL_URL}/api/v1/mailbox/${mailbox}/${last.id}`)
          ).json();
          return { html: message.body?.html ?? "", text: message.body?.text ?? "" };
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email to ${to} reached the mail catcher at ${MAIL_URL}`);
}

let userId = null;

try {
  const created = await admin.auth.admin.createUser({
    email: EMAIL,
    password: OLD_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `PKCE Reset ${STAMP}` },
  });
  if (created.error) throw created.error;
  userId = created.data.user.id;

  // --- ask for the reset, as ForgotPasswordPage does -------------------------
  // Signed out without Remember me, so the session would live in the tab's
  // sessionStorage; the link opens in a new tab of the same browser.
  const browserLocal = createMemoryStorage();
  setRememberMeFlag(false, { local: browserLocal });
  const asked = await pkceClient(browserLocal).auth.resetPasswordForEmail(EMAIL, {
    redirectTo: `${APP_ORIGIN}/reset-password`,
  });
  check("the reset email is requested", asked.error?.message ?? null, null);

  // --- the email -------------------------------------------------------------
  const email = await waitForEmail(EMAIL);
  const href = /href="([^"]+\/auth\/v1\/verify[^"]+)"/
    .exec(email.html)?.[1]
    ?.replace(/&amp;/g, "&");
  check("the email carries an Auth verify link", Boolean(href), true);
  if (!href) throw new Error(`no verify link in the email:\n${email.html || email.text}`);
  const link = new URL(href);
  check(
    "the link is a PKCE recovery token (pkce_ prefix)",
    /^pkce_/.test(link.searchParams.get("token") ?? ""),
    true,
  );
  check("the link carries no session token", hasToken(href), false);

  // --- following it: Auth redirects back with a code, not tokens --------------
  const verify = await fetch(link, { redirect: "manual" });
  const location = verify.headers.get("location") ?? "";
  check("Auth answers the link with a redirect", verify.status >= 300 && verify.status < 400, true);
  const landing = new URL(location);
  check(
    "it returns to the reset page",
    `${landing.origin}${landing.pathname}`,
    `${APP_ORIGIN}/reset-password`,
  );
  check("the return carries a one-time code", Boolean(landing.searchParams.get("code")), true);
  // This Auth version does not echo auth-js's sb_flow_id back, so the
  // exchange below finds the verifier under the fixed key auth-js mirrors
  // for the latest flow; the app passes a flow id only when one is present.
  check(
    "the return carries only Auth's code (and at most the flow id)",
    [...landing.searchParams.keys()].filter((k) => k !== "code" && k !== "sb_flow_id"),
    [],
  );
  check("no access or refresh token anywhere in the return URL", hasToken(location), false);
  check("no fragment on the return URL", landing.hash, "");

  // --- the app's landing ------------------------------------------------------
  const parts = { pathname: landing.pathname, search: landing.search, hash: landing.hash };
  const callback = readAuthCallback(parts);
  check("the app reads the return as a code", callback?.kind, "code");
  check("the app clears it from the address bar", urlWithoutAuthCallback(parts), "/reset-password");

  // Another browser, without the verifier, cannot use the code.
  const stolen = await fetch(`${URL_}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ auth_code: callback.code, code_verifier: "x".repeat(64) }),
  });
  check("the code with a wrong verifier is refused", stolen.ok, false);

  const browser = pkceClient(browserLocal);
  const exchanged = await browser.auth.exchangeCodeForSession(
    callback.code,
    callback.flowId ? { flowId: callback.flowId } : undefined,
  );
  check(
    "a new tab of the same browser exchanges the code for a session",
    exchanged.error?.message ?? null,
    null,
  );
  check("auth-js marks it a recovery redirect", exchanged.data?.redirectType, "recovery");
  const accessToken = exchanged.data?.session?.access_token ?? "";
  check(
    "the session's token names the recovery method, so AuthProvider never promotes it",
    isRecoveryAccessToken(accessToken),
    true,
  );

  const replay = await pkceClient().auth.exchangeCodeForSession(callback.code);
  check("the code cannot be used twice", Boolean(replay.error), true);

  // --- ResetPasswordPage ------------------------------------------------------
  const updated = await browser.auth.updateUser({ password: NEW_PASSWORD });
  check("the recovery session sets a new password", updated.error?.message ?? null, null);
  await browser.auth.signOut({ scope: "global" });

  const withNew = await pkceClient().auth.signInWithPassword({
    email: EMAIL,
    password: NEW_PASSWORD,
  });
  check("the new password signs in", withNew.error?.message ?? null, null);
  check(
    "a password sign-in is not a recovery session",
    isRecoveryAccessToken(withNew.data?.session?.access_token ?? ""),
    false,
  );
  const withOld = await pkceClient().auth.signInWithPassword({
    email: EMAIL,
    password: OLD_PASSWORD,
  });
  check("the old password no longer signs in", Boolean(withOld.error), true);
} catch (error) {
  console.log("FAIL - unexpected error:", error?.message ?? error);
  failures += 1;
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
