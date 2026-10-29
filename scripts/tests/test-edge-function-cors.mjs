/**
 * Edge Functions the app invokes from the browser answer the CORS preflight
 * and put the CORS headers on every response (BE-08), and the app reports a
 * failed clerk-access-notify call instead of swallowing it.
 *
 * The live half (a real preflight through the local gateway) is
 * test-edge-function-cors-live.mjs.
 *
 *   npm run test:edge-function-cors
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CORS_HEADERS, preflight, withCors } from "../../supabase/functions/_shared/cors.ts";
import {
  CLERK_ACCESS_NOTIFY_FUNCTION,
  sendClerkAccessNotice,
} from "../../src/lib/clerk-access-notify.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
// Every function the app calls with supabase.functions.invoke().
const BROWSER_INVOKED = ["clerk-access-notify", "storage-cleanup"];

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

// ---------- the shared helper ----------
{
  const answer = preflight(new Request("http://fn.test/", { method: "OPTIONS" }));
  check("an OPTIONS request gets a preflight answer", answer?.status, 200);
  check("the preflight allows any origin", answer?.headers.get("access-control-allow-origin"), "*");
  const allowed = (answer?.headers.get("access-control-allow-headers") ?? "")
    .split(",")
    .map((name) => name.trim());
  for (const header of ["authorization", "apikey", "x-client-info", "content-type"]) {
    check(
      `the preflight allows the ${header} header invoke() sends`,
      allowed.includes(header),
      true,
    );
  }
  check(
    "the preflight allows POST",
    (answer?.headers.get("access-control-allow-methods") ?? "").includes("POST"),
    true,
  );
  check(
    "a POST is not a preflight",
    preflight(new Request("http://fn.test/", { method: "POST" })),
    null,
  );
}
{
  const original = new Response("Unauthorized", {
    status: 401,
    headers: { "Content-Type": "text/plain" },
  });
  const res = withCors(original);
  check("withCors keeps the status", res.status, 401);
  check("withCors keeps the body", await res.text(), "Unauthorized");
  check("withCors keeps existing headers", res.headers.get("content-type"), "text/plain");
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    check(`withCors adds ${name}`, res.headers.get(name), value);
  }
}

// ---------- every browser-invoked function uses it ----------
for (const name of BROWSER_INVOKED) {
  const source = readFileSync(join(ROOT, "supabase/functions", name, "index.ts"), "utf8");
  check(
    `${name} imports the shared CORS helper`,
    source.includes('from "../_shared/cors.ts"'),
    true,
  );
  check(`${name} answers the preflight`, /\bpreflight\(req\)/.test(source), true);
}
{
  const source = readFileSync(
    join(ROOT, "supabase/functions/clerk-access-notify/index.ts"),
    "utf8",
  );
  check(
    "clerk-access-notify puts the CORS headers on every answer",
    source.includes("preflight(req) ?? withCors(await handle(req))"),
    true,
  );
}

// ---------- the app reports a failed notify call ----------
const capture = async (run) => {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.map(String).join(" "));
  try {
    await run();
  } finally {
    console.error = original;
  }
  return logged;
};
const fakeClient = (result) => {
  const calls = [];
  return {
    calls,
    functions: {
      invoke: async (name, options) => {
        calls.push({ name, method: options?.method, body: options?.body });
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
};
{
  const client = fakeClient({ data: { notified: 1 }, error: null });
  const logged = await capture(() => sendClerkAccessNotice(client, "request_created", "req-1"));
  check("sends the event and request id with a POST", client.calls, [
    {
      name: CLERK_ACCESS_NOTIFY_FUNCTION,
      method: "POST",
      body: { event: "request_created", request_id: "req-1" },
    },
  ]);
  check("a delivered call reports nothing", logged, []);
  check(
    "the function name matches its folder",
    CLERK_ACCESS_NOTIFY_FUNCTION,
    "clerk-access-notify",
  );
}
for (const [label, result] of [
  ["a returned FunctionsFetchError", { data: null, error: new Error("Failed to send a request") }],
  ["a thrown network error", new Error("network down")],
]) {
  const client = fakeClient(result);
  let threw = false;
  const logged = await capture(async () => {
    try {
      await sendClerkAccessNotice(client, "decision_made", "req-2");
    } catch {
      threw = true;
    }
  });
  check(`${label} never throws`, threw, false);
  check(
    `${label} is reported as an edge-function failure`,
    logged.length === 1 && logged[0].startsWith("[edge-function]"),
    true,
  );
}

console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll edge-function CORS tests passed.");
process.exit(failures > 0 ? 1 : 0);
