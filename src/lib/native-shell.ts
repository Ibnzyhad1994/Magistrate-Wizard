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
    const root = document.documentElement;
    const dark = root.classList.contains("dark");
    const highContrast = root.classList.contains("theme-high-contrast");
    const color = highContrast ? (dark ? "#000000" : "#ffffff") : dark ? "#141414" : "#f6f3ee";
    await StatusBar.setBackgroundColor({ color });
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
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
