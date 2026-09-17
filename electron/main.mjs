import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, shell } from "electron";

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

let staticServer = null;
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
  if (parsed.protocol === "http:") return allowedHttpOrigin !== null && parsed.origin === allowedHttpOrigin;
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

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#141414",
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
        `<!doctype html><html><body style="font-family:sans-serif;background:#141414;color:#fff;padding:2rem">
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

app.whenReady().then(() => {
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  staticServer?.close();
  if (process.platform !== "darwin") app.quit();
});
