// CORS for Edge Functions the app invokes from the browser, Electron or
// Capacitor. supabase.functions.invoke() sends authorization, apikey,
// x-client-info and content-type cross-origin, so the browser preflights
// every call; without an answer to OPTIONS the call never leaves the page.
//
// Any origin: the functions authenticate with the bearer token in the
// request, never with cookies, so an origin list would add no protection
// and would have to track every web, desktop and mobile origin.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** The answer to a preflight, or null when the request is not one. */
export const preflight = (req: Request): Response | null =>
  req.method === "OPTIONS" ? new Response("ok", { headers: CORS_HEADERS }) : null;

/** The same response with the CORS headers added, so the app can read errors too. */
export const withCors = (res: Response): Response => {
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};
