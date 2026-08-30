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
    `connect-src 'self' ${origin} ws: wss: https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com`,
    `frame-src 'self' blob: ${origin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ")
}
