// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * A browser can call the Edge Functions the app invokes (BE-08), through
 * the local gateway and the served functions.
 *
 *   clerk-access-notify answered every non-POST, the preflight included,
 *   with 405 and no Access-Control-* headers, so supabase.functions.invoke()
 *   from the web, Electron or Capacitor app never reached it. The
 *   preflight now passes, and its errors carry the CORS headers so the app
 *   can read them. Its caller check is unchanged: the anon key alone is
 *   still refused. storage-cleanup's preflight still passes.
 *
 *   npm run db:start && npm run test:edge-function-cors-live
 */
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-edge-function-cors-live");
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
// The dev server's origin; any origin is allowed, this is just a real one.
const ORIGIN = "http://127.0.0.1:5373";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}

const call = async (fn, init) => {
  const res = await fetch(`${URL}/functions/v1/${fn}`, init);
  await res.text();
  return res;
};

for (const fn of ["clerk-access-notify", "storage-cleanup"]) {
  // Exactly what a browser sends before supabase.functions.invoke().
  const res = await call(fn, {
    method: "OPTIONS",
    headers: {
      Origin: ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, apikey, x-client-info, content-type",
    },
  });
  check(`${fn}: the preflight is answered with 200`, res.status, 200);
  check(
    `${fn}: the preflight allows the app's origin`,
    res.headers.get("access-control-allow-origin"),
    "*",
  );
  const allowed = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
  check(
    `${fn}: the preflight allows every header invoke() sends`,
    ["authorization", "apikey", "x-client-info", "content-type"].every((h) => allowed.includes(h)),
    true,
  );
}

{
  const res = await call("clerk-access-notify", {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      Authorization: `Bearer ${ANON}`,
      apikey: ANON,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event: "request_created", request_id: crypto.randomUUID() }),
  });
  check("clerk-access-notify: the anon key alone is still refused", res.status, 401);
  check(
    "clerk-access-notify: the refusal carries the CORS header, so the app can read it",
    res.headers.get("access-control-allow-origin"),
    "*",
  );
}
{
  const res = await call("clerk-access-notify", {
    method: "GET",
    headers: { Origin: ORIGIN, Authorization: `Bearer ${ANON}`, apikey: ANON },
  });
  check("clerk-access-notify: a GET is still 405", res.status, 405);
  check(
    "clerk-access-notify: the 405 carries the CORS header",
    res.headers.get("access-control-allow-origin"),
    "*",
  );
}

console.log(
  failures > 0 ? `\n${failures} failure(s).` : "\nAll live edge-function CORS tests passed.",
);
process.exit(failures > 0 ? 1 : 0);
