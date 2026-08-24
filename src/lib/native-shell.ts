/**
 * Capacitor-only chrome: status bar colour and OAuth deep-link return.
 * No-ops in the browser and in Electron.
 */
export const initNativeShell = async () => {
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return;

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setBackgroundColor({ color: "#141414" });
    await StatusBar.setStyle({ style: Style.Dark });
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
  } catch {
    /* App plugin missing */
  }
};
