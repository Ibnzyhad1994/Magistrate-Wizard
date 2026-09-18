import { createHash } from "node:crypto";

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
 *
 * `extraSupabaseUrls` is for committed Vercel headers: that file is served
 * on every deployment of the project, including the develop preview whose
 * `VITE_SUPABASE_URL` is a different hosted project. A header that only
 * allowlists production makes login fetch fail in the browser (TypeError
 * "Failed to fetch") because header CSP and the Vite meta CSP both apply
 * and the intersection wins. Local Vite builds must not pass extras — the
 * Docker origin must stay the only Supabase host in that policy.
 */
export function supabaseCspOrigin(supabaseUrl: string): string {
  try {
    return new URL(supabaseUrl).origin;
  } catch {
    return String(supabaseUrl ?? "").replace(/\/+$/, "");
  }
}

/** Realtime uses the same host over ws/wss; an https: source does not cover it. */
export function supabaseCspWsOrigin(supabaseUrl: string): string {
  const origin = supabaseCspOrigin(supabaseUrl);
  if (origin.startsWith("https://")) return `wss://${origin.slice("https://".length)}`;
  if (origin.startsWith("http://")) return `ws://${origin.slice("http://".length)}`;
  return origin;
}

/**
 * Vercel already sends the policy as an HTTP header (`vercel.json`). A second
 * copy in a `<meta>` tag is AND-ed with that header. The two copies drifted
 * (preview vs production Supabase origin, different script hashes), and Firefox
 * reports the blocked Auth request as "NetworkError when attempting to fetch
 * resource". Native shells have no `vercel.json`, so they still need the meta.
 */
export function shouldInjectMetaCsp(
  mode: string,
  env: { VERCEL?: string } = process.env,
): boolean {
  return mode !== "development" && !env.VERCEL;
}

export function buildCsp(supabaseUrl: string, extraSupabaseUrls: readonly string[] = []): string {
  const origin = supabaseCspOrigin(supabaseUrl);
  const extraOrigins = extraSupabaseUrls
    .map(supabaseCspOrigin)
    .filter((item) => item.length > 0 && item !== origin);
  const origins = [origin, ...extraOrigins];
  const supabaseOrigins = origins.join(" ");
  const supabaseWsOrigins = origins.map(supabaseCspWsOrigin).join(" ");
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    // Fonts are self-hosted (@fontsource, see src/main.tsx) so no Google
    // Fonts origin is allowlisted — a stylesheet or font from anywhere but
    // this origin is a bug, not a feature.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' blob: data: ${supabaseOrigins}`,
    "media-src 'self' blob:",
    `connect-src 'self' ${supabaseOrigins} ${supabaseWsOrigins} https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io`,
    `frame-src 'self' blob: ${supabaseOrigins}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
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
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1] ?? "",
  );
  if (inline.length === 0) return csp;
  const hashes = inline.map(
    (source) => `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`,
  );
  return csp.replace("script-src 'self'", `script-src 'self' ${hashes.join(" ")}`);
}
