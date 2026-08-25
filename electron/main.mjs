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
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    await win.loadURL(DEV_URL);
    return;
  }

  const hosted = await startStaticServer();
  staticServer = hosted.server;
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
      else resolve({ code, redirectUri: `http://127.0.0.1:${port}/oauth/google/callback` });
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
