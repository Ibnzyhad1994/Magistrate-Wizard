import { inAppPathFromAuthDeepLink } from "@/lib/auth/auth-redirect";

/**
 * Loads the in-app page for a `magistratewizard://auth/...` deep link (a
 * Supabase Auth email return, BE-27). A full load, so AuthProvider sees the
 * code on start-up and exchanges it. False for any other link.
 */
const openAuthDeepLink = (url: string) => {
  const path = inAppPathFromAuthDeepLink(url);
  if (path) window.location.assign(path);
  return path !== null;
};

/**
 * Native chrome. Electron: Auth email deep links. Capacitor: the status
 * bar's place, Auth and OAuth deep-link returns, and flush queued hearings
 * when the app comes back to the foreground. The status bar's style and
 * colour follow the theme in `applyResolvedTheme` (`src/lib/theme.ts`).
 * No-op in the browser.
 */
export const initNativeShell = async () => {
  window.magistrateWizard?.onDeepLink?.(openAuthDeepLink);

  const cap = window.Capacitor;
  if (!cap?.isNativePlatform?.()) return;

  try {
    const { StatusBar } = await import("@capacitor/status-bar");
    // Keep the WebView below the status bar / punch-hole so the hamburger
    // is not sitting under the Galaxy S22 camera cutout.
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch {
    /* plugin unavailable in some web previews */
  }

  try {
    const { App } = await import("@capacitor/app");
    App.addListener("appUrlOpen", ({ url }) => {
      if (openAuthDeepLink(url)) return;
      if (!url.includes("oauth/google") && !url.includes("code=")) return;
      const parsed = new URL(url.replace(/^magistratewizard:/, "http://localhost"));
      const next = `/settings${parsed.search}`;
      window.location.assign(next);
    });
    App.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) return;
      void import("@/lib/offline/runtime").then(({ syncOfflineWorkNow }) => {
        void syncOfflineWorkNow();
      });
    });
  } catch {
    /* App plugin missing */
  }
};
