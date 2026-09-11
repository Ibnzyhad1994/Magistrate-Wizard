import { createHash } from "node:crypto"

/**
 * Production CSP for the Vite HTML meta tag / preview headers.
 *
 * PDF and image previews use a short-lived signed Storage URL in an
 * <iframe> / <img> (see getDocumentViewUrl). connect-src already allows
 * the Supabase origin for the JS client; without the same origin on
 * frame-src and img-src Chromium blocks the viewer:
 *   Framing 'https://<project>.supabase.co/' violates ... "frame-src 'self' blob:"
 *
 * frame-src / img-src host-sources are origin-level (paths are ignored),
 * so we pass `new URL(supabaseUrl).origin`, not a /storage/ prefix.
 */
export function supabaseCspOrigin(supabaseUrl: string): string {
  try {
    return new URL(supabaseUrl).origin
  } catch {
    return String(supabaseUrl ?? "").replace(/\/+$/, "")
  }
}

export function buildCsp(supabaseUrl: string): string {
  const origin = supabaseCspOrigin(supabaseUrl)
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    `img-src 'self' blob: data: ${origin}`,
    "media-src 'self' blob:",
    `connect-src 'self' ${origin} ws: wss: https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io`,
    `frame-src 'self' blob: ${origin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ")
}

/**
 * Returns `csp` with a sha256 hash added to `script-src` for every INLINE
 * script in `html` (scripts with a `src` attribute are untouched — they are
 * already covered by 'self').
 *
 * index.html carries one inline script: the pre-paint theme bootstrap.
 * script-src deliberately has no 'unsafe-inline' and must not gain one, so
 * the script is allowed by hash.
 *
 * Derived from the file at build time rather than written down. A
 * hand-maintained hash stops matching the moment anyone edits the script by
 * a single byte, and the only symptom is the browser silently blocking it —
 * i.e. the theme flash quietly returning with nothing failing loudly. This
 * is exported (rather than living inside vite.config.ts) so the test suite
 * can assert the real index.html against the real CSP.
 */
export function cspWithInlineScriptHashes(csp: string, html: string): string {
  const inline = [
    ...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
  ].map((match) => match[1] ?? "")
  if (inline.length === 0) return csp
  const hashes = inline.map(
    (source) => `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`,
  )
  return csp.replace("script-src 'self'", `script-src 'self' ${hashes.join(" ")}`)
}
