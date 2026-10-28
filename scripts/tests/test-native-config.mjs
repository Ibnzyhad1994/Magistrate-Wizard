/**
 * Android / Capacitor transport hardening (§3.3): cleartext and mixed
 * content are dev-only, the manifest delegates cleartext policy to
 * network_security_config.xml (emulator host + loopback only), and
 * backups are off. Launch identity: the shells open on the dark canvas with
 * the seal, never Capacitor's white template splash or its icons.
 *
 *   node scripts/tests/test-native-config.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, "../../", rel), "utf8");
const capacitor = read("capacitor.config.ts");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const nsc = read("android/app/src/main/res/xml/network_security_config.xml");
const envExample = read(".env.example");

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

// capacitor.config.ts
check("capacitor: cleartext is not hard-coded true", /cleartext:\s*true/.test(capacitor), false);
check(
  "capacitor: allowMixedContent is not hard-coded true",
  /allowMixedContent:\s*true/.test(capacitor),
  false,
);
check("capacitor: cleartext is gated on a dev flag", /cleartext:\s*isDev/.test(capacitor), true);
check(
  "capacitor: allowMixedContent is gated on a dev flag",
  /allowMixedContent:\s*isDev/.test(capacitor),
  true,
);
check(
  "capacitor: dev flag is off when NODE_ENV=production",
  capacitor.includes('process.env.NODE_ENV !== "production"'),
  true,
);
check("capacitor: androidScheme stays https", /androidScheme:\s*"https"/.test(capacitor), true);

// AndroidManifest.xml
check("manifest: allowBackup=false", manifest.includes('android:allowBackup="false"'), true);
check(
  "manifest: no blanket usesCleartextTraffic=true",
  manifest.includes('android:usesCleartextTraffic="true"'),
  false,
);
check(
  "manifest: references network_security_config",
  manifest.includes('android:networkSecurityConfig="@xml/network_security_config"'),
  true,
);

// network_security_config.xml
check(
  "nsc: base-config forbids cleartext",
  /<base-config\s+cleartextTrafficPermitted="false"/.test(nsc),
  true,
);
const domains = [...nsc.matchAll(/<domain[^>]*>([^<]+)<\/domain>/g)].map((m) => m[1].trim());
check("nsc: cleartext domains are exactly the emulator alias + loopback", domains.sort(), [
  "10.0.2.2",
  "127.0.0.1",
  "localhost",
]);
check("nsc: no includeSubdomains=true", nsc.includes('includeSubdomains="true"'), false);
check(
  "nsc: only one permissive domain-config",
  (nsc.match(/cleartextTrafficPermitted="true"/g) ?? []).length,
  1,
);

// Emulator workflow still documented
check(
  ".env.example still documents the 10.0.2.2 emulator alias",
  envExample.includes("10.0.2.2"),
  true,
);

// Launch identity (npm run native:icons draws the PNGs).
const CANVAS = "#0D0E11";
const styles = read("android/app/src/main/res/values/styles.xml");
const colors = read("android/app/src/main/res/values/colors.xml");
const launcherBackground = read("android/app/src/main/res/values/ic_launcher_background.xml");
const launchScreen = read("ios/App/App/Base.lproj/LaunchScreen.storyboard");
const indexHtml = read("index.html");
check(
  "capacitor: the WebView paints the dark canvas first",
  /^\s{2}backgroundColor:\s*"#0d0e11"/m.test(capacitor),
  true,
);
check(
  "capacitor: no SplashScreen block without the splash-screen plugin",
  /SplashScreen\s*:/.test(capacitor),
  "@capacitor/splash-screen" in JSON.parse(read("package.json")).dependencies,
);
check(
  "android: the adaptive icon sits on the dark canvas",
  launcherBackground.includes(`>${CANVAS}<`),
  true,
);
check(
  "android: app colours are defined, not the library's indigo and pink",
  ["colorPrimary", "colorPrimaryDark", "colorAccent", "mw_canvas"].every((name) =>
    colors.includes(`name="${name}"`),
  ),
  true,
);
check(
  "android: the Android 12 splash and the window behind the WebView are the canvas",
  styles.includes('<item name="windowSplashScreenBackground">@color/mw_canvas</item>') &&
    styles.includes('<item name="android:windowBackground">@color/mw_canvas</item>'),
  true,
);
check(
  "ios: the launch screen is the dark canvas, not the system white",
  launchScreen.includes("systemBackgroundColor"),
  false,
);
check(
  "web: apple-touch-icon is a PNG (iOS ignores an SVG one)",
  /rel="apple-touch-icon" href="\/apple-touch-icon\.png/.test(indexHtml),
  true,
);
// Each generated PNG is the size its slot expects and is not the template's.
const pngSize = (rel) => {
  const buf = readFileSync(join(__dirname, "../../", rel));
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};
const TEMPLATE_SPLASH_BYTES = 4040;
const launchPngs = {
  "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png": [192, 192],
  "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png": [192, 192],
  "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png": [432, 432],
  "android/app/src/main/res/drawable-port-xxxhdpi/splash.png": [1280, 1920],
  "android/app/src/main/res/drawable/splash.png": [480, 320],
  "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png": [1024, 1024],
  "ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png": [2732, 2732],
  "public/apple-touch-icon.png": [180, 180],
};
for (const [rel, size] of Object.entries(launchPngs)) {
  check(`png: ${rel} is ${size.join("x")}`, pngSize(rel), size);
}
check(
  "png: the Android splash is no longer Capacitor's template",
  readFileSync(join(__dirname, "../../", "android/app/src/main/res/drawable/splash.png"))
    .length === TEMPLATE_SPLASH_BYTES,
  false,
);

console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll native-config tests passed.");
process.exit(failures > 0 ? 1 : 0);
