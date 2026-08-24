/**
 * Copy package.json version + native/version.json versionCode into
 * Capacitor Android/iOS config so shells cannot drift from the web app.
 *
 *   npm run native:sync-version
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const versionPath = join(root, "native", "version.json");
const native = JSON.parse(readFileSync(versionPath, "utf8"));

const version = String(pkg.version);
const versionCode = Number(native.versionCode);
if (!Number.isInteger(versionCode) || versionCode < 1) {
  throw new Error(`native/version.json versionCode must be a positive integer, got ${native.versionCode}`);
}

writeFileSync(
  versionPath,
  `${JSON.stringify({ version, versionCode }, null, 2)}\n`,
);

const replaceOnce = (file, pattern, replacement) => {
  if (!existsSync(file)) return false;
  const before = readFileSync(file, "utf8");
  const after = before.replace(pattern, replacement);
  if (after === before) {
    console.warn(`No match in ${file} — skipped`);
    return false;
  }
  writeFileSync(file, after);
  return true;
};

const androidGradle = join(root, "android", "app", "build.gradle");
replaceOnce(
  androidGradle,
  /versionCode\s+\d+/,
  `versionCode ${versionCode}`,
);
replaceOnce(
  androidGradle,
  /versionName\s+"[^"]+"/,
  `versionName "${version}"`,
);

const iosPlist = join(root, "ios", "App", "App", "Info.plist");
replaceOnce(
  iosPlist,
  /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+(<\/string>)/,
  `$1${version}$2`,
);
replaceOnce(
  iosPlist,
  /(<key>CFBundleVersion<\/key>\s*<string>)[^<]+(<\/string>)/,
  `$1${versionCode}$2`,
);

const iosPbx = join(root, "ios", "App", "App.xcodeproj", "project.pbxproj");
replaceOnce(iosPbx, /MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
replaceOnce(
  iosPbx,
  /CURRENT_PROJECT_VERSION = [^;]+;/g,
  `CURRENT_PROJECT_VERSION = ${versionCode};`,
);

console.log(`Synced native version ${version} (versionCode ${versionCode})`);
console.log("Electron / electron-builder read version from package.json.");
