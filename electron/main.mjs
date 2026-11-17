import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const DEV_URL = "http://127.0.0.1:5373";
const isDev = process.env.ELECTRON_DEV === "1" && !app.isPackaged;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff2": "font/woff2",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
};

// The app's own URL scheme. Android and iOS register it too; here it
// brings Supabase Auth email links (magistratewizard://auth/...) back to
// the running app, which holds the PKCE code verifier (BE-27).
const APP_URL_SCHEME = "magistratewizard";

// The window's first colour and its title bar follow the theme the app last
// applied (the renderer reports it on every change), so a light-theme user
// never sees a dark frame. Until the first report: the dark canvas.
const THEME_FILE = () => join(app.getPath("userData"), "window-theme.json");
const DEFAULT_WINDOW_THEME = { canvas: "#0d0e11", scheme: "dark" };
const isWindowTheme = (value) =>
  value !== null &&
  typeof value === "object" &&
  typeof value.canvas === "string" &&
  /^#[0-9a-f]{6}$/i.test(value.canvas) &&
  (value.scheme === "dark" || value.scheme === "light");
const readWindowTheme = () => {
  try {
    const stored = JSON.parse(readFileSync(THEME_FILE(), "utf8"));
    return isWindowTheme(stored) ? stored : DEFAULT_WINDOW_THEME;
  } catch {
    return DEFAULT_WINDOW_THEME;
  }
};

let staticServer = null;
let mainWindow = null;
// A deep link that arrived before the renderer could take it.
let pendingDeepLink = null;
// The only origin the app window may ever navigate to: the local static
// server in production, the Vite dev server in development. Set once the
// window is created, before loadURL.
let appOrigin = null;

const sendFile = (res, filePath) => {
  const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  res.end(readFileSync(filePath));
};

const startStaticServer = () =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
      const relative = urlPath === "/" ? "/index.html" : urlPath;
      const candidate = normalize(join(DIST, relative));
      if (!candidate.startsWith(DIST)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (existsSync(candidate) && !candidate.endsWith("\\") && extname(candidate)) {
        sendFile(res, candidate);
        return;
      }
      sendFile(res, join(DIST, "index.html"));
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });

const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * URLs the renderer may hand to the OS browser. `http:` is allowed only
 * for the app's own local origin (which is what a same-window link would
 * hit anyway); everything else must be `https:` or `mailto:`. `file:`,
 * `javascript:`, custom schemes and anything unparseable are refused.
 */
export const isAllowedExternalUrl = (url, allowedHttpOrigin) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:" || parsed.protocol === "mailto:") return true;
  if (parsed.protocol === "http:")
    return allowedHttpOrigin !== null && parsed.origin === allowedHttpOrigin;
  return false;
};

const openExternalIfAllowed = (url) => {
  if (isAllowedExternalUrl(url, appOrigin)) {
    void shell.openExternal(url);
  } else {
    console.warn("[electron] blocked external URL:", url);
  }
};

const hardenWebContents = (contents) => {
  // Links / window.open never open a second BrowserWindow; safe ones go
  // to the OS browser, the rest are dropped.
  contents.setWindowOpenHandler(({ url }) => {
    openExternalIfAllowed(url);
    return { action: "deny" };
  });

  // Full-document navigations stay on the app's own origin. In-app
  // routing is pushState/hash based and does not raise these events;
  // Google OAuth on desktop runs in the OS browser via the loopback
  // server below, never inside this window.
  const guardNavigation = (event, url) => {
    if (appOrigin !== null && originOf(url) === appOrigin) return;
    event.preventDefault();
    console.warn("[electron] blocked navigation:", url);
  };
  contents.on("will-navigate", guardNavigation);
  contents.on("will-redirect", guardNavigation);
  contents.on("will-attach-webview", (event) => event.preventDefault());
};

const deepLinkFrom = (argv) => argv.find((arg) => arg.startsWith(`${APP_URL_SCHEME}://`)) ?? null;

/**
 * Hands a `magistratewizard://` link to the renderer, which loads the page
 * it names only if it is an Auth return (src/lib/auth/auth-redirect.ts).
 */
const deliverDeepLink = (url) => {
  if (!url) return;
  if (!mainWindow || mainWindow.webContents.isLoading()) {
    pendingDeepLink = url;
    return;
  }
  mainWindow.webContents.send("deep-link", url);
};

const focusMainWindow = () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
};

const createWindow = async () => {
  const theme = readWindowTheme();
  nativeTheme.themeSource = theme.scheme;
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: theme.canvas,
    icon: join(ROOT, "electron", "icon.png"),
    // Shown on its first paint, not before, so it never opens blank.
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(dirname(fileURLToPath(import.meta.url)), "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  hardenWebContents(win.webContents);
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.webContents.on("did-finish-load", () => {
    const url = pendingDeepLink;
    pendingDeepLink = null;
    deliverDeepLink(url);
  });
  win.once("ready-to-show", () => win.show());

  if (isDev) {
    appOrigin = originOf(DEV_URL);
    await win.loadURL(DEV_URL);
    return;
  }

  const hosted = await startStaticServer();
  staticServer = hosted.server;
  appOrigin = originOf(hosted.url);
  await win.loadURL(hosted.url);
};

const startGoogleLoopback = (authUrl) =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url ?? "/", `http://127.0.0.1`);
      if (requestUrl.pathname !== "/oauth/google/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state");
      const error = requestUrl.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><html><body style="font-family:sans-serif;background:#0d0e11;color:#fff;padding:2rem">
         <p>${error ? "Google sign-in was cancelled." : "Signed in. You can close this window."}</p>
         </body></html>`,
      );
      server.close();
      if (error) reject(new Error(error));
      else if (!code) reject(new Error("Google did not return an authorization code."));
      else resolve({ code, state, redirectUri: `http://127.0.0.1:${port}/oauth/google/callback` });
    });

    let port = 0;
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}/oauth/google/callback`;
      const url = new URL(authUrl);
      url.searchParams.set("redirect_uri", redirectUri);
      void shell.openExternal(url.toString());
    });
  });

ipcMain.handle("google-oauth-loopback", async (_event, authUrl) => {
  if (typeof authUrl !== "string" || !authUrl.startsWith("https://accounts.google.com/")) {
    throw new Error("Invalid Google authorization URL.");
  }
  return startGoogleLoopback(authUrl);
});

ipcMain.on("window-theme", (event, theme) => {
  if (!isWindowTheme(theme)) return;
  BrowserWindow.fromWebContents(event.sender)?.setBackgroundColor(theme.canvas);
  nativeTheme.themeSource = theme.scheme;
  try {
    writeFileSync(THEME_FILE(), JSON.stringify({ canvas: theme.canvas, scheme: theme.scheme }));
  } catch {
    /* Read-only profile: the next launch opens on the dark canvas. */
  }
});

// One running app: a deep link opened while it runs reaches this instance
// (second-instance on Windows and Linux, open-url on macOS), not a second
// copy that has neither the window nor the code verifier.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(APP_URL_SCHEME, process.execPath, [resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(APP_URL_SCHEME);
  }
  pendingDeepLink = deepLinkFrom(process.argv);

  app.on("second-instance", (_event, argv) => {
    focusMainWindow();
    deliverDeepLink(deepLinkFrom(argv));
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    focusMainWindow();
    deliverDeepLink(url);
  });

  app.whenReady().then(() => {
    void createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  staticServer?.close();
  if (process.platform !== "darwin") app.quit();
});
