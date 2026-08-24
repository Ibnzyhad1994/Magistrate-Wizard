export type OAuthPlatform = "web" | "desktop" | "android" | "ios";

declare global {
  interface Window {
    magistrateWizard?: {
      isElectron: boolean;
      startGoogleOAuth: (authUrl: string) => Promise<{ code: string; redirectUri: string }>;
    };
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  }
}

export const detectOAuthPlatform = (): OAuthPlatform => {
  if (typeof window === "undefined") return "web";
  if (window.magistrateWizard?.isElectron) return "desktop";
  const cap = window.Capacitor;
  if (cap?.isNativePlatform?.()) {
    return cap.getPlatform?.() === "ios" ? "ios" : "android";
  }
  return "web";
};

export const googleClientIdFor = (platform: OAuthPlatform = detectOAuthPlatform()) => {
  const env = import.meta.env;
  if (platform === "desktop") return env.VITE_GOOGLE_OAUTH_CLIENT_ID_DESKTOP ?? env.VITE_GOOGLE_OAUTH_CLIENT_ID_WEB ?? "";
  if (platform === "android") return env.VITE_GOOGLE_OAUTH_CLIENT_ID_ANDROID ?? env.VITE_GOOGLE_OAUTH_CLIENT_ID_WEB ?? "";
  if (platform === "ios") return env.VITE_GOOGLE_OAUTH_CLIENT_ID_IOS ?? env.VITE_GOOGLE_OAUTH_CLIENT_ID_WEB ?? "";
  return env.VITE_GOOGLE_OAUTH_CLIENT_ID_WEB ?? "";
};

export const googleRedirectUriFor = (platform: OAuthPlatform = detectOAuthPlatform()) => {
  const override = import.meta.env.VITE_GOOGLE_OAUTH_REDIRECT_URI;
  if (override) return override;
  if (platform === "desktop") return "http://127.0.0.1/oauth/google/callback";
  if (platform === "android" || platform === "ios") return "magistratewizard://oauth/google/callback";
  if (typeof window === "undefined") return "http://127.0.0.1:5373/settings";
  return `${window.location.origin}/settings`;
};

export const appOrigin = () => {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "http://127.0.0.1:5373";
};
