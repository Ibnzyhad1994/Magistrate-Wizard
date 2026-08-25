export type OAuthPlatform = "web" | "desktop" | "android" | "ios"

declare global {
  interface Window {
    magistrateWizard?: {
      isElectron: boolean
      startGoogleOAuth: (authUrl: string) => Promise<{ code: string; redirectUri: string }>
    }
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string }
  }
}

export const detectOAuthPlatform = (): OAuthPlatform => {
  if (typeof window === "undefined") return "web"
  if (window.magistrateWizard?.isElectron) return "desktop"
  const cap = window.Capacitor
  if (cap?.isNativePlatform?.()) {
    return cap.getPlatform?.() === "ios" ? "ios" : "android"
  }
  return "web"
}

export type GoogleClientIdEnv = {
  web?: string
  desktop?: string
  android?: string
  ios?: string
}

export const isLoopbackHostname = (hostname: string) =>
  hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]"

/**
 * Google “Web application” clients are confidential. Token exchange returns
 * “client_secret is missing” unless a secret is sent, and secrets must not
 * ship in the frontend. Loopback browser sessions therefore use the Desktop
 * (installed) PKCE public client.
 */
export const selectGoogleClientId = (
  platform: OAuthPlatform,
  env: GoogleClientIdEnv,
  originHostname?: string | null,
) => {
  const web = env.web ?? ""
  const desktop = env.desktop ?? ""
  if (platform === "desktop") return desktop || web
  if (platform === "android") return env.android ?? web
  if (platform === "ios") return env.ios ?? web
  if (originHostname && isLoopbackHostname(originHostname)) return desktop || web
  return web
}

export const googleClientIdFor = (platform: OAuthPlatform = detectOAuthPlatform()) => {
  const env = import.meta.env
  const hostname =
    typeof window !== "undefined" && window.location?.hostname
      ? window.location.hostname
      : null
  return selectGoogleClientId(
    platform,
    {
      web: env.VITE_GOOGLE_OAUTH_CLIENT_ID_WEB,
      desktop: env.VITE_GOOGLE_OAUTH_CLIENT_ID_DESKTOP,
      android: env.VITE_GOOGLE_OAUTH_CLIENT_ID_ANDROID,
      ios: env.VITE_GOOGLE_OAUTH_CLIENT_ID_IOS,
    },
    hostname,
  )
}

export const googleRedirectUriFor = (platform: OAuthPlatform = detectOAuthPlatform()) => {
  const override = import.meta.env.VITE_GOOGLE_OAUTH_REDIRECT_URI
  if (override) return override
  if (platform === "desktop") return "http://127.0.0.1/oauth/google/callback"
  if (platform === "android" || platform === "ios") return "magistratewizard://oauth/google/callback"
  if (typeof window === "undefined") return "http://127.0.0.1:5373/settings"
  return `${window.location.origin}/settings`
}

export const appOrigin = () => {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin
  return "http://127.0.0.1:5373"
}
