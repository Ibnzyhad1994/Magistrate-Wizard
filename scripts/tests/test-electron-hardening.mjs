/**
 * Electron shell hardening (§3.3): reads electron/main.mjs and
 * electron/preload.cjs as text and asserts the isolation flags, the
 * openExternal allowlist, and the navigation guards are present.
 *
 *   node scripts/tests/test-electron-hardening.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(__dirname, "../../electron/main.mjs"), "utf8");
const preload = readFileSync(join(__dirname, "../../electron/preload.cjs"), "utf8");
const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"));

let failures = 0;
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
};

// Renderer isolation
check("contextIsolation: true", /contextIsolation:\s*true/.test(main), true);
check("nodeIntegration: false", /nodeIntegration:\s*false/.test(main), true);
check("sandbox: true", /sandbox:\s*true/.test(main), true);
check("webviewTag: false", /webviewTag:\s*false/.test(main), true);
check("will-attach-webview is refused", main.includes('"will-attach-webview"'), true);

// window.open / external links
check("setWindowOpenHandler registered", main.includes("setWindowOpenHandler"), true);
check("window.open always denied", /return \{ action: "deny" \}/.test(main), true);
check("openExternal only via the allowlist helper", main.includes("isAllowedExternalUrl"), true);
check("allowlist accepts https:", main.includes('parsed.protocol === "https:"'), true);
check("allowlist accepts mailto:", main.includes('parsed.protocol === "mailto:"'), true);
check(
  "allowlist accepts http: only for the app origin",
  /parsed\.protocol === "http:"[\s\S]{0,120}allowedHttpOrigin/.test(main),
  true,
);
check(
  "raw shell.openExternal(url) from the open handler is gone",
  /setWindowOpenHandler\(\(\{ url \}\) => \{\s*void shell\.openExternal\(url\)/.test(main),
  false,
);

// Navigation guards
check("will-navigate guard registered", main.includes('contents.on("will-navigate"'), true);
check("will-redirect guard registered", main.includes('contents.on("will-redirect"'), true);
check("guard compares against the app origin", main.includes("originOf(url) === appOrigin"), true);
check("guard calls event.preventDefault()", main.includes("event.preventDefault()"), true);

// Loopback OAuth still only accepts Google's auth endpoint and now echoes state
check(
  "IPC only accepts accounts.google.com auth URLs",
  main.includes('authUrl.startsWith("https://accounts.google.com/")'),
  true,
);
check(
  "loopback callback returns state for the renderer to verify",
  /resolve\(\{ code, state, redirectUri/.test(main),
  true,
);

// Preload exposes only the narrow bridge
check("preload uses contextBridge", preload.includes("contextBridge.exposeInMainWorld"), true);
check(
  "preload does not expose ipcRenderer wholesale",
  /ipcRenderer\s*[,}]/.test(preload.replace(/require\("electron"\)/, "")) &&
    preload.includes("ipcRenderer:"),
  false,
);
check(
  "preload does not require fs/child_process",
  /require\("(fs|child_process|node:fs|node:child_process)"\)/.test(preload),
  false,
);

// Deprecated-API sweep for the 34 → 44 upgrade (none of these may appear)
for (const api of [
  "enableRemoteModule",
  "remote.",
  "webContents.getAllWebContents",
  "systemPreferences.isAeroGlassEnabled",
  "BrowserView",
  "app.runningUnderRosettaTranslation",
  "webContents.printToPDF(",
  "session.setDisplayMediaRequestHandler",
]) {
  check(`no deprecated/removed API: ${api}`, main.includes(api) || preload.includes(api), false);
}
check(
  "electron dependency is >= 44",
  /^\^?(4[4-9]|[5-9]\d)\./.test(
    String(pkg.devDependencies?.electron ?? pkg.dependencies?.electron ?? ""),
  ),
  true,
);

console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll electron-hardening tests passed.");
process.exit(failures > 0 ? 1 : 0);
