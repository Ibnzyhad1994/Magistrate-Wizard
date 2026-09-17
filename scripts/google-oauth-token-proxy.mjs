import { Buffer } from "node:buffer";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_OAUTH_TOKEN_PROXY_PATH = "/__mw/google-oauth-token";

/**
 * Pick the Console secret that matches the OAuth client_id in the token
 * request. Secrets stay in process env (no VITE_ prefix) so they never
 * ship in the browser bundle.
 */
export const secretForClientId = (clientId, env) => {
  const id = String(clientId ?? "");
  if (id && id === env.VITE_GOOGLE_OAUTH_CLIENT_ID_WEB && env.GOOGLE_OAUTH_CLIENT_SECRET_WEB) {
    return env.GOOGLE_OAUTH_CLIENT_SECRET_WEB;
  }
  if (
    id &&
    id === env.VITE_GOOGLE_OAUTH_CLIENT_ID_DESKTOP &&
    env.GOOGLE_OAUTH_CLIENT_SECRET_DESKTOP
  ) {
    return env.GOOGLE_OAUTH_CLIENT_SECRET_DESKTOP;
  }
  return env.GOOGLE_OAUTH_CLIENT_SECRET_DESKTOP || env.GOOGLE_OAUTH_CLIENT_SECRET_WEB || "";
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const hostnameOf = (value) => {
  if (!value) return null;
  try {
    // Origin is a full origin; Host is host[:port]. Both parse once we
    // give Host a scheme.
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * True when the request came from the dev server itself (loopback) or the
 * documented Cloudflare quick tunnel. Only those callers may have the
 * client secret attached. `server.host: true` binds the dev server to every
 * interface, so without this any LAN peer could use the proxy as a
 * secret-bearing token endpoint.
 */
export const isTrustedTokenProxyCaller = (headers) => {
  const origin = headers?.origin ? hostnameOf(String(headers.origin)) : null;
  const host = headers?.host ? hostnameOf(String(headers.host)) : null;
  const trusted = (name) =>
    name !== null && (LOOPBACK_HOSTS.has(name) || name.endsWith(".trycloudflare.com"));
  // The browser always sends Origin on a cross-origin/POST fetch; when it is
  // present it must be trusted. Host must be trusted in every case.
  if (origin !== null && !trusted(origin)) return false;
  if (headers?.origin && origin === null) return false;
  return trusted(host);
};

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

export const googleOAuthTokenProxyPlugin = (env) => ({
  name: "google-oauth-token-proxy",
  // Dev-server only; never part of a production build or `vite preview`.
  apply: "serve",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const path = req.url?.split("?")[0];
      if (path !== GOOGLE_OAUTH_TOKEN_PROXY_PATH || req.method !== "POST") {
        next();
        return;
      }
      if (!isTrustedTokenProxyCaller(req.headers)) {
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            error: "forbidden_origin",
            error_description: "Token proxy only serves the local dev server.",
          }),
        );
        return;
      }
      try {
        const raw = await readBody(req);
        const params = new URLSearchParams(raw);
        if (!params.get("client_secret")) {
          const secret = secretForClientId(params.get("client_id"), env);
          if (secret) params.set("client_secret", secret);
        }
        const googleRes = await fetch(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        const text = await googleRes.text();
        res.statusCode = googleRes.status;
        res.setHeader("Content-Type", googleRes.headers.get("content-type") || "application/json");
        res.end(text);
      } catch (error) {
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "token_proxy_failed", error_description: String(error) }));
      }
    });
  },
});
