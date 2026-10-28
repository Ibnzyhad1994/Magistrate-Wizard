// webhook-dispatch
//
// The only sender of webhook_outbox rows (0180). Each run claims due rows
// in batches of 25 through claim_webhook_deliveries(), which moves them to
// 'sending' under FOR UPDATE SKIP LOCKED so overlapping runs never take
// the same row, and marks rows of inactive endpoints 'skipped' so they
// cannot block the queue. Each batch is posted in parallel with
// signed headers (_shared/webhook-delivery.ts) and redirects are not
// followed. The real HTTP outcome is recorded on each row: 'delivered' on
// a 2xx; otherwise the row goes back to 'pending' with a growing delay
// (next_attempt_at), and on the eighth attempt it is dead-lettered as
// 'failed' for an admin to retry. A run that dies mid-way leaves its rows
// 'sending'; the next claim takes them again after five minutes, so a
// receiver may rarely see a delivery twice and should dedupe on
// X-Magistrate-Wizard-Delivery.
//
// Callers: pg_cron every minute through request_webhook_dispatch_run()
// (0180) while a row is due, or an operator.
//
// Auth: the caller must present either the project's service-role key as a
// Bearer token or an `x-cron-secret` header equal to WEBHOOK_DISPATCH_SECRET
// (set with `supabase secrets set`, for an external scheduler). The anon
// key alone is refused, so a public caller cannot drive outbound traffic at
// registered endpoints. No email.

import { createClient } from "@supabase/supabase-js";
import {
  afterDelivered,
  afterFailedDelivery,
  afterRefusedUrl,
  deliveryHeaders,
  isDeliverableUrl,
} from "../_shared/webhook-delivery.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DISPATCH_SECRET = Deno.env.get("WEBHOOK_DISPATCH_SECRET") ?? "";
const BATCH_SIZE = 25;
// A run keeps claiming while batches come back full, so a backlog drains
// several batches a minute. It starts no new batch after 15 s, so with the
// 10 s post timeout it answers inside the 30 s pg_net request timeout.
const MAX_BATCHES = 8;
const RUN_BUDGET_MS = 15_000;
const HTTP_TIMEOUT_MS = 10_000;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const constantTimeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const isAuthorised = (req: Request) => {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (bearer && constantTimeEqual(bearer, SERVICE_ROLE_KEY)) return true;
  const cron = req.headers.get("x-cron-secret") ?? "";
  return DISPATCH_SECRET.length > 0 && cron.length > 0 && constantTimeEqual(cron, DISPATCH_SECRET);
};

type ClaimedRow = {
  id: string;
  event: string;
  payload: unknown;
  attempts: number;
  url: string;
  secret: string;
};

type Outcome = "delivered" | "retrying" | "failed";

const deliver = async (row: ClaimedRow): Promise<Outcome> => {
  const record = async (fields: Record<string, unknown>) => {
    // Only the run that holds the claim may record its outcome.
    await admin.from("webhook_outbox").update(fields).eq("id", row.id).eq("status", "sending");
  };

  if (!isDeliverableUrl(row.url)) {
    await record(afterRefusedUrl(row.attempts));
    return "failed";
  }

  const body = JSON.stringify(row.payload);
  const headers = await deliveryHeaders({
    secret: row.secret,
    event: row.event,
    deliveryId: row.id,
    body,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(row.url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: controller.signal,
    });
    await res.body?.cancel();
    if (res.status >= 200 && res.status < 300) {
      await record(afterDelivered(row.attempts, res.status));
      return "delivered";
    }
    const error =
      res.status >= 300 && res.status < 400
        ? `HTTP ${res.status} (redirects are not followed)`
        : `HTTP ${res.status}`;
    const next = afterFailedDelivery(row.attempts, error, res.status);
    await record(next);
    return next.status === "failed" ? "failed" : "retrying";
  } catch (cause) {
    const error =
      cause instanceof Error
        ? cause.name === "AbortError"
          ? `Timed out after ${HTTP_TIMEOUT_MS / 1000} s`
          : cause.message
        : "dispatch failed";
    const next = afterFailedDelivery(row.attempts, error, null);
    await record(next);
    return next.status === "failed" ? "failed" : "retrying";
  } finally {
    clearTimeout(timer);
  }
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!isAuthorised(req)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const started = Date.now();
  const outcomes: Outcome[] = [];
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const { data, error } = await admin.rpc("claim_webhook_deliveries", { p_limit: BATCH_SIZE });
    if (error) {
      return json({ error: error.message }, 500);
    }
    const rows = (data ?? []) as ClaimedRow[];
    outcomes.push(...(await Promise.all(rows.map(deliver))));
    if (rows.length < BATCH_SIZE || Date.now() - started > RUN_BUDGET_MS) break;
  }

  const count = (outcome: Outcome) => outcomes.filter((o) => o === outcome).length;
  return json({
    delivered: count("delivered"),
    retrying: count("retrying"),
    failed: count("failed"),
  });
});
