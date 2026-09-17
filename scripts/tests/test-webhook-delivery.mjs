// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * Live checks for the webhook delivery repairs in 0156:
 *
 *   - webhook_outbox accepts 'sent' (pg_net hand-off) and never lets a row
 *     be born 'delivered' by the database side alone;
 *   - retry_webhook_delivery() re-queues a failed row for an admin, refuses
 *     a non-admin, and reports false for a row that is not failed;
 *   - reveal_webhook_secret() returns the secret to an admin, refuses a
 *     non-admin, and leaves an audit_log row for every reveal.
 *
 *   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-webhook-delivery.mjs
 *   (local Supabase must be running; seeded admin + magistrate personas)
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

assertLocalSupabase(URL, "test:webhook-delivery");

let failures = 0;
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
};

const service = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

const signIn = async (email) => {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`Could not sign in ${email}: ${error.message}. Run npm run db:reset.`);
  return {
    id: data.user.id,
    client: createClient(URL, ANON, {
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
      auth: { persistSession: false },
    }),
  };
};

const admin = await signIn("admin@magistrate-wizard.local");
const magistrate = await signIn("magistrate@magistrate-wizard.local");

const SECRET = "test-secret-" + Math.random().toString(16).slice(2);
let endpointId = null;
const outboxIds = [];

try {
  const { data: endpoint, error: endpointErr } = await service
    .from("webhook_endpoints")
    .insert({
      url: "http://localhost:9/never",
      secret: SECRET,
      events: ["share.granted"],
      active: false,
    })
    .select("id")
    .single();
  if (endpointErr) throw endpointErr;
  endpointId = endpoint.id;

  // --- status vocabulary ----------------------------------------------------
  const { data: sentRow, error: sentErr } = await service
    .from("webhook_outbox")
    .insert({
      endpoint_id: endpointId,
      event: "share.granted",
      payload: { fixture: true },
      status: "sent",
    })
    .select("id")
    .single();
  check("outbox accepts the 'sent' state", sentErr, null);
  if (sentRow) outboxIds.push(sentRow.id);

  const { error: bogusErr } = await service
    .from("webhook_outbox")
    .insert({ endpoint_id: endpointId, event: "share.granted", payload: {}, status: "bogus" });
  check("outbox still rejects an unknown state", Boolean(bogusErr), true);

  // --- retry ------------------------------------------------------------
  const { data: failedRow } = await service
    .from("webhook_outbox")
    .insert({
      endpoint_id: endpointId,
      event: "share.granted",
      payload: { fixture: true },
      status: "failed",
      attempts: 2,
      last_error: "HTTP 500",
    })
    .select("id")
    .single();
  outboxIds.push(failedRow.id);

  const { error: nonAdminRetry } = await magistrate.client.rpc("retry_webhook_delivery", {
    p_outbox_id: failedRow.id,
  });
  check("a non-admin cannot retry a delivery", Boolean(nonAdminRetry), true);

  const { data: retried, error: retryErr } = await admin.client.rpc("retry_webhook_delivery", {
    p_outbox_id: failedRow.id,
  });
  check("an admin can retry a failed delivery", retryErr, null);
  check("retry reports the row was re-queued", retried, true);

  const { data: after } = await service
    .from("webhook_outbox")
    .select("status, attempts, last_error")
    .eq("id", failedRow.id)
    .single();
  check("retried row is pending again", after.status, "pending");
  check("retried row keeps its attempt count", after.attempts, 2);
  check("retried row clears the last error", after.last_error, null);

  const { data: retriedAgain } = await admin.client.rpc("retry_webhook_delivery", {
    p_outbox_id: failedRow.id,
  });
  check("retrying a row that is not failed reports false", retriedAgain, false);

  // --- secret reveal ------------------------------------------------------
  const { error: nonAdminReveal } = await magistrate.client.rpc("reveal_webhook_secret", {
    p_endpoint_id: endpointId,
  });
  check("a non-admin cannot reveal a webhook secret", Boolean(nonAdminReveal), true);

  const { count: auditBefore } = await service
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("table_name", "webhook_endpoints")
    .eq("record_id", endpointId);

  const { data: revealed, error: revealErr } = await admin.client.rpc("reveal_webhook_secret", {
    p_endpoint_id: endpointId,
  });
  check("an admin can reveal the secret", revealErr, null);
  check("the revealed secret is the stored one", revealed, SECRET);

  const { data: auditRows } = await service
    .from("audit_log")
    .select("actor_id, new_data")
    .eq("table_name", "webhook_endpoints")
    .eq("record_id", endpointId)
    .order("id", { ascending: false })
    .limit(1);
  const { count: auditAfter } = await service
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("table_name", "webhook_endpoints")
    .eq("record_id", endpointId);
  check("every reveal writes one audit row", (auditAfter ?? 0) - (auditBefore ?? 0), 1);
  check("the audit row names the admin", auditRows?.[0]?.actor_id, admin.id);
  check("the audit row says what happened", auditRows?.[0]?.new_data?.event, "secret_revealed");

  const { error: unknownReveal } = await admin.client.rpc("reveal_webhook_secret", {
    p_endpoint_id: "00000000-0000-0000-0000-000000000000",
  });
  check("revealing an unknown endpoint fails", Boolean(unknownReveal), true);
} finally {
  for (const id of outboxIds) await service.from("webhook_outbox").delete().eq("id", id);
  if (endpointId) await service.from("webhook_endpoints").delete().eq("id", endpointId);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
