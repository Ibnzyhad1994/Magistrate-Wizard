import { ROUTES } from "@/routes/paths"

export const NOTIFICATION_TYPES = [
  "share_granted",
  "share_revoked",
  "judgment_final",
  "court_assigned",
  "clerk_request",
  "clerk_request_decided",
  "court_request",
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
    case "hearing_tomorrow":
      return "Hearing reminder"
    case "stale_draft":
      return "Stale draft"
    default:
      return "Notice"
  }
}
