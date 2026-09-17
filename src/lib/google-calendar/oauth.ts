import {
  detectOAuthPlatform,
  googleClientIdFor,
  googleRedirectUriFor,
  type OAuthPlatform,
} from "@/lib/google-calendar/platform";
import {
  loadGoogleCalendarState,
  saveGoogleCalendarState,
  type GoogleAuthTokens,
} from "@/lib/google-calendar/storage";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DEV_TOKEN_PROXY = "/__mw/google-oauth-token";

const googleTokenUrl = () => {
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    !window.magistrateWizard?.isElectron
  ) {
    return DEV_TOKEN_PROXY;
  }
  return TOKEN_ENDPOINT;
};

const googleTokenError = (json: Record<string, unknown>, fallback: string) => {
  const description = String(json.error_description ?? json.error ?? fallback);
  if (/client_secret is missing/i.test(description)) {
    return "Google still needs a client secret for this OAuth client. Restart the Vite server after adding GOOGLE_OAUTH_CLIENT_SECRET_* to .env.local, then click Connect again.";
  }
  return description;
};

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendars",
].join(" ");

const toBase64Url = (bytes: ArrayBuffer | Uint8Array) => {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  arr.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const randomVerifier = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
};

export const createPkce = async () => {
  const verifier = randomVerifier();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: toBase64Url(digest) };
};

/**
 * OAuth `state` = "<platform>.<random nonce>". The platform prefix is what
 * the callback route already keyed on; the nonce is a fresh 128-bit value
 * bound to this PKCE verifier and checked on the way back so a forged or
 * replayed callback (login CSRF) cannot complete the exchange.
 */
export const createOAuthState = (platform: OAuthPlatform) => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${platform}.${toBase64Url(bytes)}`;
};

export const oauthStateMatches = (
  expected: string | undefined,
  received: string | null | undefined,
) => {
  if (!expected || !received) return false;
  if (expected.length !== received.length) return false;
  // Constant-time compare; the nonce is short but there is no reason to
  // leak a prefix through early exit.
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return diff === 0;
};

export const buildGoogleAuthUrl = async (opts?: {
  platform?: OAuthPlatform;
  redirectUri?: string;
  verifier?: string;
  challenge?: string;
  state?: string;
}) => {
  const platform = opts?.platform ?? detectOAuthPlatform();
  const clientId = googleClientIdFor(platform);
  if (!clientId) {
    throw new Error("Google OAuth client ID is not configured for this platform.");
  }
  const pkce =
    opts?.challenge && opts?.verifier
      ? { verifier: opts.verifier, challenge: opts.challenge }
      : await createPkce();
  const state = opts?.state ?? createOAuthState(platform);
  const redirectUri = opts?.redirectUri ?? googleRedirectUriFor(platform);
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return { url: url.toString(), verifier: pkce.verifier, state, redirectUri, clientId, platform };
};

const tokensFromTokenResponse = (
  json: Record<string, unknown>,
  previous?: GoogleAuthTokens | null,
): GoogleAuthTokens => {
  const access = String(json.access_token ?? "");
  if (!access) throw new Error("Google did not return an access token.");
  const expiresIn = Number(json.expires_in ?? 3600);
  return {
    access_token: access,
    refresh_token: String(json.refresh_token ?? previous?.refresh_token ?? "") || undefined,
    expiry: Date.now() + Math.max(30, expiresIn - 60) * 1000,
    token_type: json.token_type ? String(json.token_type) : "Bearer",
    scope: json.scope ? String(json.scope) : undefined,
  };
};

export const exchangeGoogleCode = async (input: {
  code: string;
  redirectUri: string;
  verifier: string;
  clientId: string;
}) => {
  const body = new URLSearchParams({
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.verifier,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
  });
  const res = await fetch(googleTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(googleTokenError(json, "Google token exchange failed."));
  }
  return tokensFromTokenResponse(json);
};

export const refreshGoogleAccessToken = async (refreshToken: string, clientId: string) => {
  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(googleTokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(googleTokenError(json, "Google token refresh failed."));
  }
  return tokensFromTokenResponse(json, {
    access_token: "",
    refresh_token: refreshToken,
    expiry: 0,
  });
};

export const getValidAccessToken = async () => {
  const state = await loadGoogleCalendarState();
  if (!state.tokens) return null;
  if (state.tokens.expiry > Date.now() + 15_000) return state.tokens.access_token;
  if (!state.tokens.refresh_token) return null;
  const clientId = googleClientIdFor();
  const refreshed = await refreshGoogleAccessToken(state.tokens.refresh_token, clientId);
  await saveGoogleCalendarState({ ...state, tokens: refreshed });
  return refreshed.access_token;
};

export const beginGoogleOAuth = async () => {
  const started = await buildGoogleAuthUrl();
  const state = await loadGoogleCalendarState();
  await saveGoogleCalendarState({
    ...state,
    pkceVerifier: started.verifier,
    oauthState: started.state,
    oauthClientId: started.clientId,
    oauthRedirectUri: started.redirectUri,
  });

  if (started.platform === "desktop" && window.magistrateWizard?.startGoogleOAuth) {
    const result = await window.magistrateWizard.startGoogleOAuth(started.url);
    // The loopback server echoes Google's `state` back alongside the code
    // (electron/main.mjs); an older preload without it fails closed.
    const returnedState = (result as { state?: string | null }).state;
    if (!oauthStateMatches(started.state, returnedState)) {
      await saveGoogleCalendarState({
        ...state,
        pkceVerifier: undefined,
        oauthState: undefined,
        oauthClientId: undefined,
        oauthRedirectUri: undefined,
      });
      throw new Error(
        "Google sign-in could not be verified (state mismatch). Start Google sign-in again.",
      );
    }
    const tokens = await exchangeGoogleCode({
      code: result.code,
      redirectUri: result.redirectUri,
      verifier: started.verifier,
      clientId: started.clientId,
    });
    await saveGoogleCalendarState({
      ...state,
      tokens,
      pkceVerifier: undefined,
      oauthState: undefined,
      oauthClientId: undefined,
      oauthRedirectUri: undefined,
    });
    return { connected: true as const };
  }

  if (started.platform === "android" || started.platform === "ios") {
    window.location.assign(started.url);
    return { connected: false as const, redirected: true as const };
  }

  window.location.assign(started.url);
  return { connected: false as const, redirected: true as const };
};

export const completeGoogleOAuthFromCallback = async (params: URLSearchParams) => {
  const code = params.get("code");
  if (!code) return false;
  const state = await loadGoogleCalendarState();
  if (!state.pkceVerifier) throw new Error("Missing PKCE verifier. Start Google sign-in again.");
  if (!oauthStateMatches(state.oauthState, params.get("state"))) {
    // Reject and discard the pending verifier: a callback that does not
    // carry the nonce we issued is not one we started.
    await saveGoogleCalendarState({
      ...state,
      pkceVerifier: undefined,
      oauthState: undefined,
      oauthClientId: undefined,
      oauthRedirectUri: undefined,
    });
    throw new Error(
      "Google sign-in could not be verified (state mismatch). Start Google sign-in again.",
    );
  }
  const platform = detectOAuthPlatform();
  const tokens = await exchangeGoogleCode({
    code,
    redirectUri: state.oauthRedirectUri || googleRedirectUriFor(platform),
    verifier: state.pkceVerifier,
    clientId: state.oauthClientId || googleClientIdFor(platform),
  });
  await saveGoogleCalendarState({
    ...state,
    tokens,
    pkceVerifier: undefined,
    oauthState: undefined,
    oauthClientId: undefined,
    oauthRedirectUri: undefined,
  });
  return true;
};
