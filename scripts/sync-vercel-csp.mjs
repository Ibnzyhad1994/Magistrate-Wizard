/**
 * Generates vercel.json from the single CSP source of truth.
 *
 * The policy itself lives in scripts/content-security-policy.ts (shared with
 * vite.config.ts, which also emits it as a <meta> tag for the Capacitor and
 * Electron shells). The inline theme-bootstrap script in index.html is allowed
 * by sha256 hash, derived from the real file so the hash can never drift.
 * This script adds the header-only directive `frame-ancestors 'none'` (meta
 * CSPs cannot carry it), HSTS, and the cache rules for the hashed bundle.
 *
 * Supabase origins: vercel.json is committed and served on every Vercel
 * deployment of this project, including the develop preview whose API is
 * PREVIEW_SUPABASE_URL. The header therefore allowlists both hosted
 * projects. VITE_SUPABASE_URL is ignored here so a local Docker URL cannot
 * leak into the committed file, and so a preview-only origin cannot lock
 * production out.
 *
 *   npm run csp:sync            rewrite vercel.json
 *   npm run test:vercel-headers assert vercel.json is in sync (runs in CI)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCsp, cspWithInlineScriptHashes } from "./content-security-policy.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PRODUCTION_SUPABASE_URL = "https://gipijpeahkznfwitjccy.supabase.co";
export const PREVIEW_SUPABASE_URL = "https://kmfjejfsbtvbhvpoxvhb.supabase.co";
export const HSTS_VALUE = "max-age=63072000; includeSubDomains; preload";
export const ASSET_CACHE_VALUE = "public, max-age=31536000, immutable";
// no-store so a header-only CSP change cannot stick behind a 304 that
// reuses the previous document (and its previous Content-Security-Policy).
export const HTML_CACHE_VALUE = "no-store";

export function readIndexHtml() {
  return readFileSync(path.join(ROOT, "index.html"), "utf8");
}

export function buildVercelCsp(supabaseUrl, indexHtml) {
  const extra =
    supabaseUrl === PRODUCTION_SUPABASE_URL ? [PREVIEW_SUPABASE_URL] : [];
  return `${cspWithInlineScriptHashes(buildCsp(supabaseUrl, extra), indexHtml)}; frame-ancestors 'none'`;
}

export function renderVercelConfig({
  supabaseUrl = PRODUCTION_SUPABASE_URL,
  indexHtml = readIndexHtml(),
} = {}) {
  return {
    rewrites: [{ source: "/(.*)", destination: "/index.html" }],
    headers: [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: buildVercelCsp(supabaseUrl, indexHtml) },
          { key: "Cache-Control", value: HTML_CACHE_VALUE },
          { key: "Strict-Transport-Security", value: HSTS_VALUE },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
        ],
      },
      {
        source: "/index.html",
        headers: [{ key: "Cache-Control", value: HTML_CACHE_VALUE }],
      },
      {
        source: "/assets/(.*)",
        headers: [{ key: "Cache-Control", value: ASSET_CACHE_VALUE }],
      },
    ],
  };
}

export function renderVercelJson(options) {
  return `${JSON.stringify(renderVercelConfig(options), null, 2)}\n`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const target = path.join(ROOT, "vercel.json");
  const next = renderVercelJson({ supabaseUrl: PRODUCTION_SUPABASE_URL });
  const check = process.argv.includes("--check");
  let current = "";
  try {
    current = readFileSync(target, "utf8").replace(/\r\n/g, "\n");
  } catch {
    current = "";
  }
  if (current === next) {
    console.log("vercel.json is up to date");
  } else if (check) {
    console.error(
      "vercel.json is out of sync with scripts/sync-vercel-csp.mjs; run `npm run csp:sync`",
    );
    process.exit(1);
  } else {
    writeFileSync(target, next);
    console.log(
      `vercel.json written (Supabase origins ${PRODUCTION_SUPABASE_URL} ${PREVIEW_SUPABASE_URL})`,
    );
  }
}
