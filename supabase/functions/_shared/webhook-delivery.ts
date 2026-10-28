// The webhook-dispatch function's delivery rules (0180), pure so
// scripts/tests/test-webhook-delivery-rules.mjs can check them without a
// database or a network:
//
//   - which URLs may be posted to (the same rule as the
//     webhook_endpoints_url_allowed constraint);
//   - the signed headers of one delivery;
//   - what a webhook_outbox row becomes after a delivery: 'delivered' on a
//     2xx, otherwise back to 'pending' on the shared retry schedule
//     (retry-schedule.ts), and 'failed' (dead-lettered) on the last attempt.

import { MAX_ATTEMPTS, afterFailedAttempt } from "./retry-schedule.ts";

export { MAX_ATTEMPTS };

// https to any host, or plain http to the local development hosts only.
// No user info (`user@host`), so `http://localhost@elsewhere` is refused.
const HTTPS_URL = /^https:\/\/[^/?#@\s]+(\/\S*)?$/;
const LOCAL_HTTP_URL =
  /^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:[0-9]{1,5})?(\/\S*)?$/;

export const isDeliverableUrl = (url: string) => HTTPS_URL.test(url) || LOCAL_HTTP_URL.test(url);

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const hmacSha256Hex = async (secret: string, message: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
};

// X-Magistrate-Wizard-Signature signs the body alone, as it always has.
// X-Magistrate-Wizard-Signature-V2 also signs the delivery id and the
// timestamp, so a receiver can drop a duplicate (the same delivery id) and
// refuse a replay (an old timestamp) of a captured request.
export const deliveryHeaders = async (input: {
  secret: string;
  event: string;
  deliveryId: string;
  body: string;
  now?: number;
}) => {
  const timestamp = String(Math.floor((input.now ?? Date.now()) / 1000));
  const [bodySignature, v2Signature] = await Promise.all([
    hmacSha256Hex(input.secret, input.body),
    hmacSha256Hex(input.secret, `${timestamp}.${input.deliveryId}.${input.body}`),
  ]);
  return {
    "Content-Type": "application/json",
    "X-Magistrate-Wizard-Event": input.event,
    "X-Magistrate-Wizard-Delivery": input.deliveryId,
    "X-Magistrate-Wizard-Timestamp": timestamp,
    "X-Magistrate-Wizard-Signature": `sha256=${bodySignature}`,
    "X-Magistrate-Wizard-Signature-V2": `sha256=${v2Signature}`,
  };
};

export const afterDelivered = (previousAttempts: number, statusCode: number, now = Date.now()) => ({
  status: "delivered" as const,
  attempts: previousAttempts + 1,
  delivered_at: new Date(now).toISOString(),
  last_attempt_at: new Date(now).toISOString(),
  last_status_code: statusCode,
  last_error: null,
  locked_at: null,
});

// statusCode is null when no response came back (timeout, refused, DNS).
export const afterFailedDelivery = (
  previousAttempts: number,
  error: string,
  statusCode: number | null,
  now = Date.now(),
) => {
  const { attempts, next_attempt_at, dead_lettered_at } = afterFailedAttempt(previousAttempts, now);
  return {
    status: dead_lettered_at ? ("failed" as const) : ("pending" as const),
    attempts,
    next_attempt_at,
    dead_lettered_at,
    last_attempt_at: new Date(now).toISOString(),
    last_status_code: statusCode,
    last_error: error,
    locked_at: null,
  };
};

// A URL the rule refuses is never posted to: the row fails for good.
export const afterRefusedUrl = (previousAttempts: number, now = Date.now()) => ({
  status: "failed" as const,
  attempts: previousAttempts,
  dead_lettered_at: new Date(now).toISOString(),
  last_attempt_at: new Date(now).toISOString(),
  last_status_code: null,
  last_error: "Endpoint URL is not allowed (https, or http to a local development host)",
  locked_at: null,
});
