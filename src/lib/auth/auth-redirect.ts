import { ROUTES } from "@/routes/paths";

/**
 * Supabase Auth email links under the PKCE flow (BE-27).
 *
 * An email link (password reset, signup confirmation) goes to Auth's verify
 * endpoint, which redirects back with a one-time `?code=` instead of the
 * implicit flow's `#access_token=...&refresh_token=...`, so no token ever
 * lands in the URL, browser history or anything that reads `location`. The
 * app trades the code for a session with the code verifier it stored when
 * it asked for the email, so the link only works in the browser or app that
 * asked for it.
 *
 * The native shells cannot receive an https link, so they ask Auth to come
 * back through the app's own scheme (`magistratewizard://auth/<path>`), which
 * Android, iOS and the Electron desktop app all register; the shell hands
 * the URL to inAppPathFromAuthDeepLink and loads the path it returns.
 */

export const APP_URL_SCHEME = "magistratewizard";

/** The scheme's host for Auth returns; Google Calendar uses `oauth`. */
export const AUTH_DEEP_LINK_HOST = "auth";

/** PKCE flow id Auth appends to the redirect (auth-js PKCE_FLOW_ID_PARAM). */
const FLOW_ID_PARAM = "sb_flow_id";

/** The in-app paths an Auth email may return to. */
const AUTH_RETURN_PATHS: readonly string[] = [ROUTES.login, ROUTES.resetPassword];

/** Query and fragment keys an Auth return can carry, removed once read. */
const AUTH_RETURN_KEYS = [
  "code",
  FLOW_ID_PARAM,
  "error",
  "error_code",
  "error_description",
  "type",
  "access_token",
  "refresh_token",
  "expires_at",
  "expires_in",
  "token_type",
  "provider_token",
  "provider_refresh_token",
];

export type UrlParts = { pathname: string; search: string; hash: string };

export type AuthCallback =
  { kind: "code"; code: string; flowId: string | null } | { kind: "error"; message: string };

/** The URL an Auth email should send the person back to for `path`. */
export function authRedirectUrl(path: string, shell: { native: boolean; origin: string }): string {
  return shell.native
    ? `${APP_URL_SCHEME}://${AUTH_DEEP_LINK_HOST}${path}`
    : `${shell.origin}${path}`;
}

/**
 * The in-app path (with its query) for a `magistratewizard://auth/...` deep
 * link, or null for anything else: another scheme, the Google Calendar
 * `oauth` host, or a path that is not an Auth return.
 */
export function inAppPathFromAuthDeepLink(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_URL_SCHEME}:` || parsed.hostname !== AUTH_DEEP_LINK_HOST) {
    return null;
  }
  if (!AUTH_RETURN_PATHS.includes(parsed.pathname)) return null;
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * What an Auth email return left in the URL, or null when this is not one.
 * Only the Auth return paths count: Google Calendar also comes back with a
 * `?code=`, to Settings, and that code is not Auth's.
 */
export function readAuthCallback(url: UrlParts): AuthCallback | null {
  if (!AUTH_RETURN_PATHS.includes(url.pathname)) return null;
  const query = new URLSearchParams(url.search);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const error =
    query.get("error_description") ??
    fragment.get("error_description") ??
    query.get("error") ??
    fragment.get("error");
  if (error) return { kind: "error", message: error };
  const code = query.get("code");
  if (code) return { kind: "code", code, flowId: query.get(FLOW_ID_PARAM) };
  // An implicit-flow link sent before the switch to PKCE: its tokens are
  // never used, only cleared from the address bar.
  if (fragment.has("access_token")) {
    return { kind: "error", message: "This link is no longer valid. Request a new one." };
  }
  return null;
}

/** `url` as a path with every Auth return parameter removed. */
export function urlWithoutAuthCallback(url: UrlParts): string {
  const query = new URLSearchParams(url.search);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  for (const key of AUTH_RETURN_KEYS) {
    query.delete(key);
    fragment.delete(key);
  }
  const search = query.toString();
  const hash = fragment.toString();
  return `${url.pathname}${search ? `?${search}` : ""}${hash ? `#${hash}` : ""}`;
}

/**
 * True for a session Auth issued from a password-recovery link (its access
 * token's `amr` names the `recovery` method). Such a session exists only so
 * the reset page can set a new password; it must never count as a sign-in,
 * not on landing, not after a reload and not when its token refreshes.
 */
export function isRecoveryAccessToken(accessToken: string): boolean {
  const payload = accessToken.split(".")[1];
  if (!payload) return false;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as {
      amr?: Array<{ method?: string } | string>;
    };
    return (claims.amr ?? []).some(
      (entry) => (typeof entry === "string" ? entry : entry?.method) === "recovery",
    );
  } catch {
    return false;
  }
}
