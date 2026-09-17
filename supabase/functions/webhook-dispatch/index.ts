// webhook-dispatch
//
// Posts pending webhook_outbox rows with HMAC-SHA256 signatures and records
// the real HTTP outcome: 'delivered' only on a 2xx, 'failed' otherwise
// (including a 10 s timeout). Attempts are incremented on every try.
//
// Auth: the caller must present either the project's service-role key as a
// Bearer token or an `x-cron-secret` header equal to WEBHOOK_DISPATCH_SECRET
// (set with `supabase secrets set`). The anon key alone is refused, so a
// public caller cannot drive outbound traffic at registered endpoints.
// No email.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DISPATCH_SECRET = Deno.env.get("WEBHOOK_DISPATCH_SECRET") ?? "";
const HTTP_TIMEOUT_MS = 10_000;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

const sign = async (secret: string, body: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return toHex(signature);
};

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

const postWithTimeout = async (url: string, init: RequestInit) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!isAuthorised(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: rows, error } = await admin
    .from("webhook_outbox")
    .select("id, event, payload, attempts, endpoint_id, webhook_endpoints(url, secret, active)")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(25);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let delivered = 0;
  let failed = 0;
  for (const row of rows ?? []) {
    const endpoint = Array.isArray(row.webhook_endpoints)
      ? row.webhook_endpoints[0]
      : row.webhook_endpoints;
    if (!endpoint?.active || !endpoint.url || !endpoint.secret) continue;
    const body = JSON.stringify(row.payload);
    const hex = await sign(endpoint.secret, body);
    const attempts = (row.attempts ?? 0) + 1;
    try {
      const res = await postWithTimeout(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Magistrate-Wizard-Signature": `sha256=${hex}`,
          "X-Magistrate-Wizard-Event": row.event,
        },
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await admin
        .from("webhook_outbox")
        .update({
          status: "delivered",
          attempts,
          delivered_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id);
      delivered += 1;
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.name === "AbortError"
            ? `Timed out after ${HTTP_TIMEOUT_MS / 1000} s`
            : cause.message
          : "dispatch failed";
      await admin
        .from("webhook_outbox")
        .update({ status: "failed", attempts, last_error: message })
        .eq("id", row.id);
      failed += 1;
    }
  }

  return new Response(JSON.stringify({ delivered, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
