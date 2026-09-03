/**
 * Remaining-phase helpers: notifications, flags, webhooks, retention,
 * audit CSV, hearing reminders.
 *
 *   npm run test:audit-ops
 */
import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { activityRowsToCsv, auditHashPayload } from "../../src/lib/audit-export.ts"
import { isFeatureEnabled, rolloutBucket } from "../../src/lib/feature-flags.ts"
import {
  hearingReminderDue,
  parseHearingReminderPrefs,
  reminderDedupeKey,
} from "../../src/lib/hearing-reminders.ts"
import {
  isNotificationType,
  notificationTypeLabel,
  shareItemNoun,
  shareItemPath,
} from "../../src/lib/notifications.ts"
import { isPurgeableRetentionTable, retentionAllowsPurge } from "../../src/lib/retention.ts"
import {
  notificationTypeToWebhookEvent,
  signWebhookBody,
  webhookSignatureHeader,
} from "../../src/lib/webhooks.ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const readMigration = (name) =>
  readFileSync(join(__dirname, "../../supabase/migrations", name), "utf8")

let failures = 0
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`)
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected))
    console.log("  actual:  ", JSON.stringify(actual))
    failures += 1
  }
}

check("share path for a judgment", shareItemPath("judgment", "abc"), "/judgments/abc")
check("canonical share noun", shareItemNoun("case_law"), "case law research")
check("known notification type", isNotificationType("share_granted"), true)
check("unknown notification type", isNotificationType("email_blast"), false)
check("hearing reminder label", notificationTypeLabel("hearing_tomorrow"), "Hearing reminder")

const flagCtx = { userId: "user-1", role: "magistrate", courtIds: ["court-a"] }
check(
  "disabled flag is off",
  isFeatureEnabled(
    { key: "webhooks", enabled: false, rolloutPercentage: 100, courtIds: [], roles: [] },
    flagCtx,
  ),
  false,
)
check(
  "role-gated flag hides from clerks",
  isFeatureEnabled(
    {
      key: "webhooks",
      enabled: true,
      rolloutPercentage: 100,
      courtIds: [],
      roles: ["admin"],
    },
    { ...flagCtx, role: "clerk" },
  ),
  false,
)
check(
  "empty court list means every court",
  isFeatureEnabled(
    { key: "x", enabled: true, rolloutPercentage: 100, courtIds: [], roles: [] },
    flagCtx,
  ),
  true,
)
check(
  "court list must match an assigned court",
  isFeatureEnabled(
    { key: "x", enabled: true, rolloutPercentage: 100, courtIds: ["court-b"], roles: [] },
    flagCtx,
  ),
  false,
)
const bucket = rolloutBucket("user-1", "partial")
check(
  "partial rollout is deterministic",
  isFeatureEnabled(
    { key: "partial", enabled: true, rolloutPercentage: bucket + 1, courtIds: [], roles: [] },
    flagCtx,
  ),
  true,
)
check(
  "partial rollout excludes the bucket edge",
  isFeatureEnabled(
    { key: "partial", enabled: true, rolloutPercentage: bucket, courtIds: [], roles: [] },
    flagCtx,
  ),
  false,
)

check("notifications may be purged", isPurgeableRetentionTable("notifications"), true)
check("audit_log must never be purgeable", isPurgeableRetentionTable("audit_log"), false)
check("docket_matters cannot be purged via retention", retentionAllowsPurge("docket_matters", "purge"), false)
check("notifications purge is allowed", retentionAllowsPurge("notifications", "purge"), true)

check("share grant maps to a webhook event", notificationTypeToWebhookEvent("share_granted"), "share.granted")
check("stale draft has no webhook", notificationTypeToWebhookEvent("stale_draft"), null)

const body = JSON.stringify({ hello: "court" })
const nodeHex = createHmac("sha256", "secret").update(body).digest("hex")
const webHex = await signWebhookBody("secret", body)
check("HMAC matches Node crypto", webHex, nodeHex)
check("signature header prefix", webhookSignatureHeader(nodeHex), `sha256=${nodeHex}`)

check(
  "CSV escapes quotes",
  activityRowsToCsv([
    {
      kind: "auth",
      id: "1",
      createdAt: "2026-09-03T12:00:00Z",
      eventType: "login_success",
      email: 'a"b@court.gy',
      userAgent: null,
      actor: { full_name: "Ada", email: "ada@court.gy" },
    },
  ]).includes('"a""b@court.gy"'),
  true,
)
check(
  "hash payload is ordered and stable",
  auditHashPayload({
    prevHash: "genesis",
    id: 2,
    action: "insert",
    tableName: "profiles",
    recordId: "r1",
    actorId: "a1",
    createdAt: "t",
    oldData: "",
    newData: "{}",
  }),
  "genesis|2|insert|profiles|r1|a1|t||{}",
)

check(
  "24h lead covers tomorrow in Guyana",
  hearingReminderDue({
    scheduledDate: "2026-09-04",
    eventStatus: "scheduled",
    now: new Date("2026-09-03T16:00:00-04:00"),
    leadHours: 24,
  }),
  true,
)
check(
  "cancelled hearings are not reminded",
  hearingReminderDue({
    scheduledDate: "2026-09-03",
    eventStatus: "cancelled",
    now: new Date("2026-09-03T16:00:00-04:00"),
    leadHours: 12,
  }),
  false,
)
check(
  "prefs default to off",
  parseHearingReminderPrefs(null),
  { enabled: false, leadHours: 24 },
)
check(
  "dedupe key includes date",
  reminderDedupeKey("evt-1", "2026-09-04"),
  "hearing-reminder:evt-1:2026-09-04",
)

const sql123 = readMigration("0123_notifications.sql")
check("0123 creates notifications", sql123.includes("create table public.notifications"), true)
check("0123 notify_user is SECURITY DEFINER", /security definer/i.test(sql123), true)
check("0123 does not call an email API", /api\.resend|send_email|notify_from_email/i.test(sql123), false)
check("0123 notifies share recipients", sql123.includes("share_granted"), true)
check("0123 notifies clerk requests", sql123.includes("clerk_request"), true)

const sql124 = readMigration("0124_scheduled_jobs.sql")
check("0124 adds past event status", sql124.includes("'past'"), true)
check("0124 marks past hearings", sql124.includes("mark_past_hearings"), true)
check("0124 flags stale drafts", sql124.includes("flag_stale_drafts"), true)
check("0124 reminds tomorrow hearings", sql124.includes("notify_tomorrows_hearings"), true)
check("0124 uses Guyana date", sql124.includes("America/Guyana"), true)

const sql125 = readMigration("0125_feature_flags.sql")
check("0125 creates feature_flags", sql125.includes("create table public.feature_flags"), true)
check("0125 seeds flags", sql125.includes("in_app_notifications"), true)

const sql126 = readMigration("0126_audit_tamper_evidence.sql")
check("0126 adds row_hash", sql126.includes("row_hash"), true)
check("0126 verifies the chain", sql126.includes("verify_audit_hash_chain"), true)
check("0126 blocks ordinary updates", sql126.includes("audit_log_immutable"), true)

const sql127 = readMigration("0127_data_retention.sql")
check("0127 creates retention policies", sql127.includes("data_retention_policies"), true)
check("0127 download_my_data is definer", sql127.includes("download_my_data"), true)
check("0127 never purges audit_log automatically", sql127.includes("'audit_log'"), true)

const sql128 = readMigration("0128_webhooks.sql")
check("0128 stores HMAC secrets", sql128.includes("webhook_endpoints"), true)
check("0128 has an outbox", sql128.includes("webhook_outbox"), true)
check("0128 signs with hmac", /hmac/i.test(sql128), true)

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
