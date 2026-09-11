import { ROUTES } from "@/routes/paths"

export const NOTIFICATION_TYPES = [
  "share_granted",
  "share_revoked",
  "judgment_final",
  "court_assigned",
  "clerk_request",
  "clerk_request_decided",
  "court_request",
  "court_request_decided",
  "account_type_corrected",
  "hearing_tomorrow",
  "stale_draft",
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export const isNotificationType = (value: string): value is NotificationType =>
  (NOTIFICATION_TYPES as readonly string[]).includes(value)

export const shareItemPath = (itemType: string, itemId: string) => {
  if (itemType === "docket_matter") return ROUTES.docketMatter(itemId)
  if (itemType === "judgment") return ROUTES.judgmentDetail(itemId)
  if (itemType === "case_law") return ROUTES.caseLawDetail(itemId)
  return ROUTES.dashboard
}

export const shareItemNoun = (itemType: string) => {
  if (itemType === "docket_matter") return "docket matter"
  if (itemType === "judgment") return "judgment"
  if (itemType === "case_law") return "case law research"
  return "item"
}

/**
 * What a notice means for the reader, which is what its colour should
 * encode — not which subsystem raised it.
 *
 *   action   something is waiting on YOU to decide or turn up
 *   granted  access or a milestone you gained
 *   revoked  access you lost
 *   outcome  a decision about you that needs no action
 *
 * Deliberately four tones, not eleven: a list where every row is a
 * different colour communicates nothing. `outcome` is intentionally the
 * neutral one — "request decided" covers both approval and refusal, and
 * colouring it green or red would assert a result the type alone doesn't
 * carry.
 */
export type NotificationTone = "action" | "granted" | "revoked" | "outcome"

export const notificationTone = (type: string): NotificationTone => {
  switch (type) {
    case "clerk_request":
    case "court_request":
    case "hearing_tomorrow":
    case "stale_draft":
      return "action"
    case "share_granted":
    case "court_assigned":
    case "judgment_final":
      return "granted"
    case "share_revoked":
      return "revoked"
    default:
      return "outcome"
  }
}

export const notificationTypeLabel = (type: string) => {
  switch (type) {
    case "share_granted":
      return "Share granted"
    case "share_revoked":
      return "Share revoked"
    case "judgment_final":
      return "Judgment finalized"
    case "court_assigned":
      return "Court assignment"
    case "clerk_request":
      return "Clerk request"
    case "clerk_request_decided":
      return "Clerk request decided"
    case "court_request":
      return "Court request"
    case "court_request_decided":
      return "Court request decided"
    case "account_type_corrected":
      return "Account type corrected"
    case "hearing_tomorrow":
      return "Hearing reminder"
    case "stale_draft":
      return "Stale draft"
    default:
      return "Notice"
  }
}
