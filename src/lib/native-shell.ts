/**
 * Capacitor-only chrome: status bar colour, OAuth deep-link return,
 * and flush queued hearings when the app comes back to the foreground.
 * No-ops in the browser and in Electron.
 */
export const initNativeShell = async () => {
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return;

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setBackgroundColor({ color: "#141414" });
    await StatusBar.setStyle({ style: Style.Dark });
    // Keep the WebView below the status bar / punch-hole so the hamburger
    // is not sitting under the Galaxy S22 camera cutout.
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch {
    /* plugin unavailable in some web previews */
  }

  try {
    const { App } = await import("@capacitor/app");
    App.addListener("appUrlOpen", ({ url }) => {
      if (!url.includes("oauth/google") && !url.includes("code=")) return;
      const parsed = new URL(url.replace(/^magistratewizard:/, "http://localhost"));
      const next = `/settings${parsed.search}`;
      window.location.assign(next);
    });
    App.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) return;
      void import("@/lib/offline/runtime").then(({ flushPendingHearings }) => {
        void flushPendingHearings();
      });
    });
  } catch {
    /* App plugin missing */
  }
};
