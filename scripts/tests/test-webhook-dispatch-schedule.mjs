// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * Webhooks are delivered on a schedule with their real HTTP result (0180),
 * on a real database with pg_cron, pg_net, Vault and the webhook-dispatch
 * Edge Function posting to a real HTTP receiver this script runs.
 *
 *   BE-06  60 events for a healthy endpoint, queued behind 30 of an
 *          inactive one (more than one 25-row batch, which the old
 *          dispatcher could never get past), all arrive within a couple of
 *          cron ticks, each exactly once, signed, with its delivery id;
 *          the inactive endpoint's rows are marked skipped and never sent;
 *          a 500 is recorded with its status code and retried a minute
 *          later, a redirect is not followed, and the eighth failure
 *          dead-letters the row as failed until an admin retries it;
 *          two overlapping claims never take the same row;
 *          with the Vault secret missing nothing is requested and nothing
 *          raises (checked in a rolled-back transaction through psql);
 *          no client role can ask for a run or claim rows.
 *
 * Needs the scheduled-call configuration that live-db.yml writes after
 * `supabase start` (pg_net plus the project_url and service_role_key Vault
 * secrets); see supabase/README.md "Scheduled Edge Function calls". The
 * local Edge Functions reach this script's receiver as
 * host.docker.internal (WEBHOOK_RECEIVER_HOST overrides it). The
 * missing-secret check runs SQL through psql (test-support/psql.mjs).
 * Creates its own endpoints and rows and removes them afterwards, pass or
 * fail.
 *
 *   npm run db:start && npm run test:webhook-dispatch-schedule
 */
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";
import { runSql, sections } from "../test-support/psql.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-webhook-dispatch-schedule");
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const RECEIVER_HOST = process.env.WEBHOOK_RECEIVER_HOST ?? "host.docker.internal";

// Two one-minute cron ticks plus the function's own run time.
const DELIVERY_DEADLINE_MS = 150_000;

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
const must = ({ data, error }, label) => {
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const admin = createClient(URL, SERVICE, noSession);
const MARK = `BE06-${Date.now() % 1_000_000}`;
const SECRET = `${MARK}-signing-secret`;

// ---------- the receiver ----------
// /ok answers 200, /fail 500, /redirect 302 to /ok; every request is kept.
const received = [];
const receiver = createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const path = new globalThis.URL(req.url, "http://receiver").pathname;
    received.push({ path, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
    if (path.endsWith("/redirect")) {
      res.writeHead(302, { Location: path.replace(/\/redirect$/, "/ok") }).end();
    } else if (path.endsWith("/fail")) {
      res.writeHead(500).end("receiver error");
    } else {
      res.writeHead(200).end("ok");
    }
  });
});
await new Promise((resolve) => receiver.listen(0, "0.0.0.0", resolve));
const base = `http://${RECEIVER_HOST}:${receiver.address().port}/${MARK}`;
const hits = (path) => received.filter((r) => r.path === `/${MARK}/${path}`);

const endpointIds = [];
const addEndpoint = async (path, active = true) => {
  const row = must(
    await admin
      .from("webhook_endpoints")
      .insert({ url: `${base}/${path}`, secret: SECRET, events: [`${MARK}.event`], active })
      .select("id")
      .single(),
    `endpoint ${path}`,
  );
  endpointIds.push(row.id);
  return row.id;
};
const queue = async (endpointId, count, fields = {}) =>
  must(
    await admin
      .from("webhook_outbox")
      .insert(
        Array.from({ length: count }, (_, i) => ({
          endpoint_id: endpointId,
          event: `${MARK}.event`,
          payload: { mark: MARK, n: i },
          ...fields,
        })),
      )
      .select("id"),
    "queue rows",
  ).map((row) => row.id);
const rowsOf = async (endpointId) =>
  must(
    await admin
      .from("webhook_outbox")
      .select(
        "id, status, attempts, last_error, last_status_code, last_attempt_at, next_attempt_at, delivered_at, dead_lettered_at",
      )
      .eq("endpoint_id", endpointId),
    "outbox rows",
  );

async function main() {
  // ---------- no client role can ask for a run or claim rows ----------
  const anon = createClient(URL, ANON, noSession);
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({
    email: "magistrate@magistrate-wizard.local",
    password: "password123",
  });
  if (signInError) throw new Error(`sign in: ${signInError.message}. Run npm run db:reset.`);
  const signedIn = createClient(URL, ANON, {
    ...noSession,
    global: { headers: { Authorization: `Bearer ${signIn.session.access_token}` } },
  });
  for (const [who, client] of [
    ["anon", createClient(URL, ANON, noSession)],
    ["a signed-in user", signedIn],
  ]) {
    for (const [fn, args] of [
      ["request_webhook_dispatch_run", {}],
      ["claim_webhook_deliveries", { p_limit: 1 }],
      ["request_edge_function_run", { p_function: "webhook-dispatch" }],
    ]) {
      const { error } = await client.rpc(fn, args);
      check(`BE-06 ${who} cannot call ${fn}`, !!error, true);
    }
  }
  {
    const res = await fetch(`${URL}/functions/v1/webhook-dispatch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ANON}`, apikey: ANON },
    });
    check("BE-06 webhook-dispatch refuses the anon key", res.status, 401);
  }

  // ---------- endpoint URLs ----------
  {
    const { error } = await admin.from("webhook_endpoints").insert({
      url: "http://localhost@attacker.example/hook",
      secret: SECRET,
      events: [],
      active: false,
    });
    check("BE-06 a URL with user info is refused", !!error, true);
  }
  {
    const { error } = await admin.from("webhook_endpoints").insert({
      url: "http://hooks.example.com/hook",
      secret: SECRET,
      events: [],
      active: false,
    });
    check("BE-06 plain http to a public host is refused", !!error, true);
  }

  // ---------- two overlapping claims never take the same row ----------
  // Rows the schedule may also claim; every claim, the test's or a run's,
  // must be disjoint from the others.
  const claimEndpoint = await addEndpoint("claim");
  const claimRows = await queue(claimEndpoint, 40);
  {
    const [first, second] = await Promise.all([
      admin.rpc("claim_webhook_deliveries", { p_limit: 25 }),
      admin.rpc("claim_webhook_deliveries", { p_limit: 25 }),
    ]);
    const ids = [...must(first, "claim 1"), ...must(second, "claim 2")]
      .map((row) => row.id)
      .filter((id) => claimRows.includes(id));
    check("BE-06 overlapping claims return no row twice", new Set(ids).size, ids.length);
    check("BE-06 the claims took rows", ids.length > 0, true);
    const sending = (await rowsOf(claimEndpoint)).filter((row) => ids.includes(row.id));
    check(
      "BE-06 claimed rows are sending",
      sending.every((row) => row.status === "sending"),
      true,
    );
    must(
      await admin.from("webhook_outbox").delete().eq("endpoint_id", claimEndpoint),
      "drop claim rows",
    );
  }

  // ---------- delivery on the schedule ----------
  const inactive = await addEndpoint("inactive", false);
  const healthy = await addEndpoint("ok");
  const failing = await addEndpoint("fail");
  const redirecting = await addEndpoint("redirect");
  const anHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  // Older than everything else, so a dispatcher that took the oldest rows
  // without skipping them would never reach the healthy endpoint.
  await queue(inactive, 30, { created_at: anHourAgo, next_attempt_at: anHourAgo });
  const healthyIds = await queue(healthy, 60);
  const [failingId] = await queue(failing, 1);
  const [redirectId] = await queue(redirecting, 1);
  const [lastChanceId] = await queue(failing, 1, { attempts: 7 });

  const started = Date.now();
  let settled = false;
  while (Date.now() - started < DELIVERY_DEADLINE_MS) {
    const healthyRows = await rowsOf(healthy);
    const failingRows = await rowsOf(failing);
    const [redirectRow] = await rowsOf(redirecting);
    const failingRow = failingRows.find((row) => row.id === failingId);
    const lastChanceRow = failingRows.find((row) => row.id === lastChanceId);
    if (
      healthyRows.every((row) => row.status === "delivered") &&
      failingRow?.attempts > 0 &&
      redirectRow?.attempts > 0 &&
      lastChanceRow?.status === "failed"
    ) {
      settled = true;
      break;
    }
    await sleep(2_000);
  }
  console.log(`  (waited ${Math.round((Date.now() - started) / 1000)}s for the schedule)`);
  check("BE-06 the schedule settled every row within two ticks", settled, true);

  {
    const rows = await rowsOf(healthy);
    check(
      "BE-06 all 60 healthy rows are delivered",
      rows.filter((row) => row.status === "delivered").length,
      60,
    );
    check(
      "BE-06 each with its 200 and one attempt",
      rows.every((row) => row.last_status_code === 200 && row.attempts === 1 && row.delivered_at),
      true,
    );
    const ok = hits("ok");
    const ids = ok.map((r) => r.headers["x-magistrate-wizard-delivery"]);
    check("BE-06 the receiver got 60 requests", ok.length, 60);
    check("BE-06 no delivery arrived twice", new Set(ids).size, 60);
    check("BE-06 the delivery ids are the outbox ids", [...ids].sort(), [...healthyIds].sort());
    const sample = ok[0];
    const hmac = (message) => createHmac("sha256", SECRET).update(message).digest("hex");
    check(
      "BE-06 the body signature verifies",
      sample?.headers["x-magistrate-wizard-signature"],
      `sha256=${hmac(sample?.body ?? "")}`,
    );
    check(
      "BE-06 the v2 signature covers timestamp and delivery id",
      sample?.headers["x-magistrate-wizard-signature-v2"],
      `sha256=${hmac(
        `${sample?.headers["x-magistrate-wizard-timestamp"]}.${sample?.headers["x-magistrate-wizard-delivery"]}.${sample?.body}`,
      )}`,
    );
    check(
      "BE-06 the event is named",
      sample?.headers["x-magistrate-wizard-event"],
      `${MARK}.event`,
    );
  }
  {
    const rows = await rowsOf(inactive);
    check(
      "BE-06 the inactive endpoint's rows are skipped",
      rows.every((row) => row.status === "skipped"),
      true,
    );
    check("BE-06 and never sent", hits("inactive").length, 0);
  }
  {
    const row = (await rowsOf(failing)).find((r) => r.id === failingId);
    check("BE-06 a 500 is recorded", [row?.last_status_code, row?.last_error], [500, "HTTP 500"]);
    check("BE-06 and the row is queued again", row?.status, "pending");
    const delay = Date.parse(row?.next_attempt_at) - Date.parse(row?.last_attempt_at);
    check("BE-06 at least a minute after its last attempt", delay >= 59_000, true);
  }
  {
    const row = (await rowsOf(redirecting)).find((r) => r.id === redirectId);
    check("BE-06 a redirect is recorded, not followed", row?.last_status_code, 302);
    check("BE-06 with the reason", row?.last_error, "HTTP 302 (redirects are not followed)");
    check(
      "BE-06 the redirect target never saw it",
      hits("ok").some((r) => r.headers["x-magistrate-wizard-delivery"] === redirectId),
      false,
    );
  }
  {
    const row = (await rowsOf(failing)).find((r) => r.id === lastChanceId);
    check("BE-06 the eighth failure dead-letters the row", row?.status, "failed");
    check("BE-06 with attempts and time", [row?.attempts, !!row?.dead_lettered_at], [8, true]);

    const { data: adminSignIn, error } = await anon.auth.signInWithPassword({
      email: "admin@magistrate-wizard.local",
      password: "password123",
    });
    if (error) throw new Error(`admin sign in: ${error.message}`);
    const adminClient = createClient(URL, ANON, {
      ...noSession,
      global: { headers: { Authorization: `Bearer ${adminSignIn.session.access_token}` } },
    });
    check(
      "BE-06 an admin can retry it",
      must(
        await adminClient.rpc("retry_webhook_delivery", { p_outbox_id: lastChanceId }),
        "admin retry",
      ),
      true,
    );
    // Due at once, so a run may already have tried it again (and, being
    // past the limit, failed it again).
    const after = (await rowsOf(failing)).find((r) => r.id === lastChanceId);
    check(
      "BE-06 the retried row is due again, or already re-attempted",
      (["pending", "sending"].includes(after?.status) &&
        after?.dead_lettered_at === null &&
        Date.parse(after?.next_attempt_at) <= Date.now()) ||
        after?.attempts > 8,
      true,
    );
  }

  // ---------- with a Vault secret missing nothing is requested ----------
  {
    const sql = `
      begin;
      with e as (
        insert into public.webhook_endpoints (url, secret, events, active)
        values ('https://hooks.example.invalid/${MARK}', 'x', '{}', true)
        returning id
      )
      insert into public.webhook_outbox (endpoint_id, event, payload)
      select id, '${MARK}.psql', '{}'::jsonb from e;
      \\echo @@with-secrets
      select public.request_webhook_dispatch_run() is not null;
      delete from vault.secrets where name = 'service_role_key';
      \\echo @@without-secret
      select coalesce(public.request_webhook_dispatch_run()::text, 'null');
      \\echo @@maintenance
      select public.dispatch_pending_webhooks();
      rollback;
    `;
    const out = sections(runSql(sql, "test-webhook-dispatch-schedule"));
    check("BE-06 control: with the secrets a run is requested", out["with-secrets"], "t");
    check("BE-06 without a secret nothing is requested", out["without-secret"], "null");
    check("BE-06 and the daily maintenance call stays quiet", out.maintenance, "0");
  }

  console.log(
    failures > 0 ? `\n${failures} failure(s).` : "\nAll webhook dispatch schedule tests passed.",
  );
}

async function cleanup() {
  try {
    if (endpointIds.length > 0) {
      await admin.from("webhook_outbox").delete().in("endpoint_id", endpointIds);
      await admin.from("webhook_endpoints").delete().in("id", endpointIds);
    }
  } catch (err) {
    console.error("Cleanup encountered an error:", err);
  }
  await new Promise((resolve) => receiver.close(resolve));
}

try {
  await main();
} catch (err) {
  console.error("Test run threw:", err);
  failures += 1;
} finally {
  await cleanup();
}
process.exit(failures > 0 ? 1 : 0);
