// webhook-dispatch
//
// Posts pending webhook_outbox rows with HMAC-SHA256 signatures.
// Invoke with a service role or a scheduled job. No email.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { data: rows, error } = await admin
    .from("webhook_outbox")
    .select("id, event, payload, endpoint_id, webhook_endpoints(url, secret, active)")
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
    try {
      const res = await fetch(endpoint.url, {
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
          attempts: 1,
          delivered_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id);
      delivered += 1;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "dispatch failed";
      await admin
        .from("webhook_outbox")
        .update({ status: "failed", attempts: 1, last_error: message })
        .eq("id", row.id);
      failed += 1;
    }
  }

  return new Response(JSON.stringify({ delivered, failed }), {
    headers: { "Content-Type": "application/json" },
  });
});
