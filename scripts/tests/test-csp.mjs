// Regression: signed Storage preview URLs must be frameable/image-loadable.
// Run: node scripts/tests/test-csp.mjs

import { buildCsp, supabaseCspOrigin } from "../content-security-policy.ts"

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
const local = "http://127.0.0.1:55321"

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

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
