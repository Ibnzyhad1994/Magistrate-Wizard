/**
 * Link-safety guards from the 2026-09-17 security audit (§3.3):
 *   - isSafeHref (html-sanitize.ts) gates every DB-controlled anchor via
 *     SafeExternalLink
 *   - isSafeInternalPath (safe-navigation.ts) gates notifications.link
 *   - the case-law zod schema refuses non-http(s) source_url values
 *   - the dev token proxy only serves loopback / trycloudflare callers
 *
 *   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-safe-links.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isSafeHref } from "../../src/lib/html-sanitize.ts";
import { isSafeInternalPath } from "../../src/lib/safe-navigation.ts";
import { caseLawFieldsSchema } from "../../src/lib/validations/case-law.ts";
import {
  isTrustedTokenProxyCaller,
  googleOAuthTokenProxyPlugin,
} from "../google-oauth-token-proxy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(__dirname, "../../", rel), "utf8");

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

// --- isSafeHref -------------------------------------------------------------
check("https accepted", isSafeHref("https://laws.example.gov/act/1"), true);
check("http accepted", isSafeHref("http://laws.example.gov/act/1"), true);
check("mailto accepted", isSafeHref("mailto:clerk@example.gov"), true);
check("javascript: rejected", isSafeHref("javascript:alert(1)"), false);
check("JAVASCRIPT: (case) rejected", isSafeHref("JaVaScRiPt:alert(1)"), false);
check("data: rejected", isSafeHref("data:text/html;base64,PHNjcmlwdD4="), false);
check("vbscript: rejected", isSafeHref("vbscript:msgbox"), false);
check("file: rejected", isSafeHref("file:///etc/passwd"), false);
check("control-char smuggling rejected", isSafeHref("java\u0000script:alert(1)"), false);
check("empty rejected", isSafeHref(""), false);

// --- isSafeInternalPath -----------------------------------------------------
check("plain path accepted", isSafeInternalPath("/notifications"), true);
check("path with query accepted", isSafeInternalPath("/docket/abc?tab=1"), true);
check("protocol-relative rejected", isSafeInternalPath("//evil.example/x"), false);
check("backslash-relative rejected", isSafeInternalPath("/\\evil.example"), false);
check("absolute https rejected", isSafeInternalPath("https://evil.example/"), false);
check("javascript: rejected", isSafeInternalPath("javascript:alert(1)"), false);
check("relative (no leading slash) rejected", isSafeInternalPath("docket"), false);
check("null rejected", isSafeInternalPath(null), false);
check("undefined rejected", isSafeInternalPath(undefined), false);
check("empty rejected", isSafeInternalPath(""), false);
check(
  "scheme after the leading slash is just a path segment, accepted",
  isSafeInternalPath("/javascript:alert(1)"),
  true,
);

// --- zod refine on case-law source_url -------------------------------------
const base = {
  case_name: "R v Example",
  citation: "[2026] GY 1",
  court: "Magistrates' Court",
  jurisdiction: "Guyana",
};
check(
  "zod: https source_url passes",
  caseLawFieldsSchema.safeParse({ ...base, source_url: "https://x.example/a" }).success,
  true,
);
check(
  "zod: empty source_url passes",
  caseLawFieldsSchema.safeParse({ ...base, source_url: "" }).success,
  true,
);
check("zod: omitted source_url passes", caseLawFieldsSchema.safeParse({ ...base }).success, true);
check(
  "zod: javascript: source_url fails",
  caseLawFieldsSchema.safeParse({ ...base, source_url: "javascript:alert(1)" }).success,
  false,
);
check(
  "zod: data: source_url fails",
  caseLawFieldsSchema.safeParse({ ...base, source_url: "data:text/html,hi" }).success,
  false,
);
check(
  "zod: ftp: source_url fails",
  caseLawFieldsSchema.safeParse({ ...base, source_url: "ftp://x.example/a" }).success,
  false,
);

// --- SafeExternalLink is what the three source_url sites render ------------
for (const rel of [
  "src/pages/case-law/case-law-detail-page.tsx",
  "src/pages/legislation/legislation-viewer-page.tsx",
  "src/pages/admin/legal-library-admin-page.tsx",
]) {
  const src = read(rel);
  check(
    `${rel} imports SafeExternalLink`,
    src.includes("@/components/common/safe-external-link"),
    true,
  );
  check(
    `${rel} has no raw <a href={…source_url}>`,
    /<a\s+href=\{[^}]*source_url\}/.test(src),
    false,
  );
}
const safeLink = read("src/components/common/safe-external-link.tsx");
check("SafeExternalLink gates on isSafeHref", safeLink.includes("isSafeHref(href)"), true);
check(
  "SafeExternalLink sets rel noopener noreferrer",
  safeLink.includes('rel="noopener noreferrer"'),
  true,
);

// --- notifications.link guard ---------------------------------------------
check(
  "notification-bell guards navigate(row.link)",
  read("src/components/layout/notification-bell.tsx").includes(
    "if (isSafeInternalPath(row.link)) navigate(row.link)",
  ),
  true,
);
check(
  "notifications-page guards the Link target",
  read("src/pages/notifications/notifications-page.tsx").includes(
    "if (!isSafeInternalPath(row.link)) return",
  ),
  true,
);

// --- dev token proxy ---------------------------------------------------------
check("proxy plugin is serve-only", googleOAuthTokenProxyPlugin({}).apply, "serve");
check(
  "proxy: loopback Host, no Origin → trusted",
  isTrustedTokenProxyCaller({ host: "127.0.0.1:5373" }),
  true,
);
check(
  "proxy: localhost Origin → trusted",
  isTrustedTokenProxyCaller({ host: "localhost:5373", origin: "http://localhost:5373" }),
  true,
);
check(
  "proxy: trycloudflare Origin → trusted",
  isTrustedTokenProxyCaller({
    host: "abc-def.trycloudflare.com",
    origin: "https://abc-def.trycloudflare.com",
  }),
  true,
);
check("proxy: LAN Host → refused", isTrustedTokenProxyCaller({ host: "192.168.1.20:5373" }), false);
check(
  "proxy: foreign Origin with loopback Host → refused",
  isTrustedTokenProxyCaller({ host: "127.0.0.1:5373", origin: "https://evil.example" }),
  false,
);
check(
  "proxy: lookalike trycloudflare.com.evil → refused",
  isTrustedTokenProxyCaller({ host: "x.trycloudflare.com.evil.example" }),
  false,
);
check("proxy: missing headers → refused", isTrustedTokenProxyCaller({}), false);

console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll safe-link tests passed.");
process.exit(failures > 0 ? 1 : 0);
