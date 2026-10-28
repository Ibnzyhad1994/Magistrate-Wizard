/**
 * The webhook-dispatch function's delivery rules (0180, BE-06), without a
 * database or a network:
 *
 *   - only https URLs, or plain http to a local development host, are
 *     posted to, and user info cannot smuggle another host past the rule;
 *   - each delivery carries its id and a timestamp, and a signature over
 *     both plus the body, beside the body-only signature receivers already
 *     verify;
 *   - a 2xx marks the row delivered; any other result puts it back in the
 *     queue on the shared retry schedule, and the eighth attempt
 *     dead-letters it as failed.
 *
 * The live half (the schedule, the claim, skipped rows, real HTTP results)
 * is test-webhook-dispatch-schedule.mjs.
 *
 *   npm run test:webhook-delivery-rules
 */
import { createHmac } from "node:crypto";
import {
  MAX_ATTEMPTS,
  afterDelivered,
  afterFailedDelivery,
  afterRefusedUrl,
  deliveryHeaders,
  isDeliverableUrl,
} from "../../supabase/functions/_shared/webhook-delivery.ts";

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

const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const MINUTE = 60_000;

// ---------- URLs ----------
for (const url of [
  "https://hooks.example.com/magistrate",
  "https://hooks.example.com:8443/a/b?c=d",
  "http://localhost:8080/hook",
  "http://127.0.0.1/hook",
  "http://host.docker.internal:4000/hook",
]) {
  check(`allowed: ${url}`, isDeliverableUrl(url), true);
}
for (const url of [
  "http://hooks.example.com/magistrate",
  "http://localhost.example.com/hook",
  "http://localhost@attacker.example/hook",
  "https://user@hooks.example.com/hook",
  "http://127.0.0.1.nip.io/hook",
  "ftp://hooks.example.com/",
  "https://hooks.example.com/with space",
  "https://",
]) {
  check(`refused: ${url}`, isDeliverableUrl(url), false);
}

// ---------- headers ----------
{
  const body = JSON.stringify({ type: "share_granted", title: "Shared" });
  const headers = await deliveryHeaders({
    secret: "s3cret",
    event: "share.granted",
    deliveryId: "11111111-2222-3333-4444-555555555555",
    body,
    now: NOW,
  });
  const hmac = (message) => createHmac("sha256", "s3cret").update(message).digest("hex");
  check("the event is named", headers["X-Magistrate-Wizard-Event"], "share.granted");
  check(
    "the delivery id is sent",
    headers["X-Magistrate-Wizard-Delivery"],
    "11111111-2222-3333-4444-555555555555",
  );
  check(
    "the timestamp is in seconds",
    headers["X-Magistrate-Wizard-Timestamp"],
    String(NOW / 1000),
  );
  check(
    "the body signature is unchanged for existing receivers",
    headers["X-Magistrate-Wizard-Signature"],
    `sha256=${hmac(body)}`,
  );
  check(
    "the v2 signature covers timestamp, delivery id and body",
    headers["X-Magistrate-Wizard-Signature-V2"],
    `sha256=${hmac(`${NOW / 1000}.11111111-2222-3333-4444-555555555555.${body}`)}`,
  );
}

// ---------- outcomes ----------
{
  const done = afterDelivered(2, 204, NOW);
  check("a 2xx marks the row delivered", done.status, "delivered");
  check("and counts the attempt", done.attempts, 3);
  check("and records the status code", done.last_status_code, 204);
  check("and clears the error and the claim", [done.last_error, done.locked_at], [null, null]);
  check("and stamps the delivery", done.delivered_at, new Date(NOW).toISOString());
}
{
  const first = afterFailedDelivery(0, "HTTP 500", 500, NOW);
  check("a first failure goes back in the queue", first.status, "pending");
  check("a minute later", (Date.parse(first.next_attempt_at) - NOW) / MINUTE, 1);
  check(
    "with the status code and error",
    [first.last_status_code, first.last_error],
    [500, "HTTP 500"],
  );
  check("and the claim released", first.locked_at, null);
  check("and is not dead-lettered", first.dead_lettered_at, null);
}
{
  const delay = (previous) =>
    (Date.parse(afterFailedDelivery(previous, "x", null, NOW).next_attempt_at) - NOW) / MINUTE;
  check("the delay doubles", [1, 2, 3].map(delay), [2, 4, 8]);
  check(
    "no response records no status code",
    afterFailedDelivery(0, "x", null, NOW).last_status_code,
    null,
  );
}
{
  const last = afterFailedDelivery(MAX_ATTEMPTS - 1, "HTTP 503", 503, NOW);
  check("eight attempts is the limit", MAX_ATTEMPTS, 8);
  check("the last attempt dead-letters the row as failed", last.status, "failed");
  check("with its dead-letter time", last.dead_lettered_at, new Date(NOW).toISOString());
}
{
  const refused = afterRefusedUrl(0, NOW);
  check(
    "a refused URL fails the row for good",
    [refused.status, !!refused.dead_lettered_at],
    ["failed", true],
  );
  check("without counting a post that never happened", refused.attempts, 0);
}

console.log(
  failures > 0 ? `\n${failures} failure(s).` : "\nAll webhook delivery rule tests passed.",
);
process.exit(failures > 0 ? 1 : 0);
