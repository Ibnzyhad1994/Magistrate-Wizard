// Regression: vercel.json must be the output of scripts/sync-vercel-csp.mjs
// (the CSP source of truth) and carry the hardening headers we rely on.
// Run: npm run test:vercel-headers   (fix drift with: npm run csp:sync)

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  ASSET_CACHE_VALUE,
  HSTS_VALUE,
  HTML_CACHE_VALUE,
  PRODUCTION_SUPABASE_URL,
  readIndexHtml,
  renderVercelJson,
} from "../sync-vercel-csp.mjs";

let failures = 0;
const check = (label, actual, expected) => {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", expected);
    console.log("  actual:  ", actual);
    failures += 1;
  }
};

const committed = readFileSync("vercel.json", "utf8").replace(/\r\n/g, "\n");
const generated = renderVercelJson({ supabaseUrl: PRODUCTION_SUPABASE_URL });

check(
  "vercel.json matches the generator (run `npm run csp:sync` if not)",
  committed === generated,
  true,
);

const config = JSON.parse(committed);
const rule = (source) => config.headers.find((entry) => entry.source === source);
const header = (source, key) => rule(source)?.headers.find((h) => h.key === key)?.value;

check("SPA rewrite is intact", config.rewrites?.[0]?.destination, "/index.html");

const csp = header("/(.*)", "Content-Security-Policy") ?? "";
check(
  "CSP header is the full policy, not just frame-ancestors",
  csp.startsWith("default-src 'self'"),
  true,
);
check("CSP keeps frame-ancestors 'none'", csp.includes("frame-ancestors 'none'"), true);
check("CSP allows the production Supabase origin", csp.includes(PRODUCTION_SUPABASE_URL), true);
check("CSP does not carry a local Docker origin", /127\.0\.0\.1|localhost/.test(csp), false);
check("script-src has no 'unsafe-inline'", /script-src[^;]*'unsafe-inline'/.test(csp), false);

const inline = [
  ...readIndexHtml().matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
].map((m) => m[1]);
const expectedHash = `'sha256-${createHash("sha256")
  .update(inline[0] ?? "", "utf8")
  .digest("base64")}'`;
check("CSP carries the hash of the real inline theme bootstrap", csp.includes(expectedHash), true);

check("HSTS is set with preload", header("/(.*)", "Strict-Transport-Security"), HSTS_VALUE);
check("HSTS max-age is two years", HSTS_VALUE.includes("max-age=63072000"), true);
check("X-Frame-Options stays DENY", header("/(.*)", "X-Frame-Options"), "DENY");
check("nosniff stays", header("/(.*)", "X-Content-Type-Options"), "nosniff");
check(
  "hashed bundle assets are immutable",
  header("/assets/(.*)", "Cache-Control"),
  ASSET_CACHE_VALUE,
);
check("index.html is never cached", header("/index.html", "Cache-Control"), HTML_CACHE_VALUE);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
