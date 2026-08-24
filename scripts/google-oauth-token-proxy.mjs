import { Buffer } from "node:buffer"

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
export const GOOGLE_OAUTH_TOKEN_PROXY_PATH = "/__mw/google-oauth-token"

/**
 * Pick the Console secret that matches the OAuth client_id in the token
 * request. Secrets stay in process env (no VITE_ prefix) so they never
 * ship in the browser bundle.
 */
export const secretForClientId = (clientId, env) => {
  const id = String(clientId ?? "")
  if (id && id === env.VITE_GOOGLE_OAUTH_CLIENT_ID_WEB && env.GOOGLE_OAUTH_CLIENT_SECRET_WEB) {
    return env.GOOGLE_OAUTH_CLIENT_SECRET_WEB
  }
  if (id && id === env.VITE_GOOGLE_OAUTH_CLIENT_ID_DESKTOP && env.GOOGLE_OAUTH_CLIENT_SECRET_DESKTOP) {
    return env.GOOGLE_OAUTH_CLIENT_SECRET_DESKTOP
  }
  return env.GOOGLE_OAUTH_CLIENT_SECRET_DESKTOP || env.GOOGLE_OAUTH_CLIENT_SECRET_WEB || ""
}

const readBody = async (req) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}

export const googleOAuthTokenProxyPlugin = (env) => ({
  name: "google-oauth-token-proxy",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const path = req.url?.split("?")[0]
      if (path !== GOOGLE_OAUTH_TOKEN_PROXY_PATH || req.method !== "POST") {
        next()
        return
      }
      try {
        const raw = await readBody(req)
        const params = new URLSearchParams(raw)
        if (!params.get("client_secret")) {
          const secret = secretForClientId(params.get("client_id"), env)
          if (secret) params.set("client_secret", secret)
        }
        const googleRes = await fetch(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        })
        const text = await googleRes.text()
        res.statusCode = googleRes.status
        res.setHeader("Content-Type", googleRes.headers.get("content-type") || "application/json")
        res.end(text)
      } catch (error) {
        res.statusCode = 502
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify({ error: "token_proxy_failed", error_description: String(error) }))
      }
    })
  },
})
