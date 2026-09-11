// Regression: signed Storage preview URLs must be frameable/image-loadable.
// Run: node scripts/tests/test-csp.mjs

import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { buildCsp, cspWithInlineScriptHashes, supabaseCspOrigin } from "../content-security-policy.ts"

let failures = 0
const check = (label, actual, expected) => {
  const pass = actual === expected
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`)
  if (!pass) {
    console.log("  expected:", expected)
    console.log("  actual:  ", actual)
    failures += 1
  }
}

const production = "https://gipijpeahkznfwitjccy.supabase.co"
const withSlash = `${production}/`
const local = "http://127.0.0.1:56321"

check("production URL origin has no trailing slash", supabaseCspOrigin(production), production)
check("trailing slash is stripped to origin", supabaseCspOrigin(withSlash), production)
check("local supabase origin is preserved", supabaseCspOrigin(local), local)

const csp = buildCsp(withSlash)
const frameSrc = csp.split("; ").find((d) => d.startsWith("frame-src")) ?? ""
check("frame-src allows the supabase origin (PDF iframe)", frameSrc, `frame-src 'self' blob: ${production}`)
check("img-src allows the supabase origin (image preview)", csp.includes(`img-src 'self' blob: data: ${production}`), true)
check("connect-src still allows the supabase origin", csp.includes(`connect-src 'self' ${production} `), true)
check("object-src stays none", csp.includes("object-src 'none'"), true)
check("a different host is not allowlisted", csp.includes("https://evil.example"), false)

const localCsp = buildCsp(local)
check("local frame-src uses the local origin, not production", localCsp.includes(`frame-src 'self' blob: ${local}`), true)
check("local CSP does not leak the production host", localCsp.includes("gipijpeahkznfwitjccy"), false)


// --- inline-script hashing --------------------------------------------------
// index.html carries a pre-paint theme bootstrap. script-src has no
// 'unsafe-inline' (and must never gain one), so that script is allowed by
// sha256 hash instead. If the hash and the script ever diverge the browser
// silently blocks it and the only visible symptom is the theme flash coming
// back -- nothing errors. So assert them against each other here, using the
// real index.html rather than a fixture.

const indexHtml = readFileSync("index.html", "utf8")
const inlineScripts = [
  ...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
].map((m) => m[1])

check("index.html has exactly one inline script (the theme bootstrap)", inlineScripts.length, 1)
check(
  "that script is the theme bootstrap, not something unexpected",
  inlineScripts[0].includes("magistrate-wizard-theme"),
  true,
)

const hashedCsp = cspWithInlineScriptHashes(buildCsp(production), indexHtml)
const expectedHash = `'sha256-${createHash("sha256").update(inlineScripts[0], "utf8").digest("base64")}'`
check("the CSP carries a hash matching the real inline script", hashedCsp.includes(expectedHash), true)
// style-src legitimately carries 'unsafe-inline' (Radix and Tailwind
// arbitrary values both emit inline styles), so this has to be scoped to
// script-src rather than checking the whole policy string.
const scriptSrc = hashedCsp.split("; ").find((d) => d.startsWith("script-src")) ?? ""
check("script-src does not gain 'unsafe-inline' — the hash is the whole point", scriptSrc.includes("unsafe-inline"), false)
check("style-src still has 'unsafe-inline' (Radix/Tailwind inline styles)", hashedCsp.includes("style-src 'self' 'unsafe-inline'"), true)
check("'self' survives alongside the hash", hashedCsp.includes("script-src 'self' 'sha256-"), true)
check("wasm-unsafe-eval is preserved (pdf.js/tesseract need it)", hashedCsp.includes("'wasm-unsafe-eval'"), true)

// A page with no inline script must come back untouched, so the helper can
// never quietly rewrite a CSP it had no reason to change.
check(
  "html with no inline script leaves the CSP identical",
  cspWithInlineScriptHashes(buildCsp(production), "<html><body><script src=\"/a.js\"></script></body></html>"),
  buildCsp(production),
)

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
