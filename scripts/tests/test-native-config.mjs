/**
 * Android / Capacitor transport hardening (§3.3): cleartext and mixed
 * content are dev-only, the manifest delegates cleartext policy to
 * network_security_config.xml (emulator host + loopback only), and
 * backups are off.
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

console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll native-config tests passed.");
process.exit(failures > 0 ? 1 : 0);
