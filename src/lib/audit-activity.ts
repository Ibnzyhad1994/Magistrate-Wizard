import type { Json } from "@/types/database.types"

export const ACCESS_AUDIT_TABLES = [
  "profiles",
  "magistrate_courts",
  "magistrate_court_requests",
  "clerk_courts",
  "clerk_access_requests",
  "shares",
  "docket_matter_assignments",
] as const

export const LIBRARY_AUDIT_TABLES = ["statutes", "case_law", "documents"] as const

export const DOCKET_AUDIT_TABLES = ["docket_matters"] as const

export const INSTITUTIONAL_AUDIT_TABLES = [
  ...ACCESS_AUDIT_TABLES,
  ...LIBRARY_AUDIT_TABLES,
  ...DOCKET_AUDIT_TABLES,
] as const

export type InstitutionalAuditTable = (typeof INSTITUTIONAL_AUDIT_TABLES)[number]

export type ActivityFilter = "all" | "access" | "library" | "docket" | "signin"

export type AuthEventType =
  | "login_success"
  | "login_failed"
  | "logout"
  | "password_reset_requested"

export type AuditAction = "insert" | "update" | "delete"

export interface FieldChange {
  label: string
  from: string
  to: string
}

export interface ActivitySummary {
  category: Exclude<ActivityFilter, "all">
  badge: string
  title: string
  subject: string | null
}

const TABLE_LABELS: Record<InstitutionalAuditTable, string> = {
  profiles: "Account",
  magistrate_courts: "Court assignment",
  magistrate_court_requests: "Court request",
  clerk_courts: "Clerk access",
  clerk_access_requests: "Clerk request",
  shares: "Docket share",
  docket_matter_assignments: "Retained matter",
  statutes: "Legislation",
  case_law: "Case law",
  documents: "Document",
  docket_matters: "Docket",
}

const HIDDEN_DETAIL_KEYS = new Set([
  "full_text",
  "summary",
  "content",
  "content_text",
  "search_vector",
  "file_path",
  "body_text",
  "annotation_text",
  "contact_info",
  "description",
  "avatar_url",
])

const asRecord = (value: Json | null | undefined): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

const asText = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return null
}

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined) return "—"
  if (typeof value === "string") return value || "—"
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return "—"
}

const personLabel = (row: Record<string, unknown>): string | null =>
  asText(row.full_name) ?? asText(row.email)

const isLibraryTable = (tableName: string): tableName is (typeof LIBRARY_AUDIT_TABLES)[number] =>
  (LIBRARY_AUDIT_TABLES as readonly string[]).includes(tableName)

const isDocketTable = (tableName: string): tableName is (typeof DOCKET_AUDIT_TABLES)[number] =>
  (DOCKET_AUDIT_TABLES as readonly string[]).includes(tableName)

export const tablesForFilter = (filter: ActivityFilter): readonly string[] => {
  if (filter === "access") return ACCESS_AUDIT_TABLES
  if (filter === "library") return LIBRARY_AUDIT_TABLES
  if (filter === "docket") return DOCKET_AUDIT_TABLES
  if (filter === "signin") return []
  return INSTITUTIONAL_AUDIT_TABLES
}

export const summarizeAuthEvent = (
  eventType: AuthEventType,
  email: string | null,
): ActivitySummary => {
  const subject = email
  if (eventType === "login_success") {
    return { category: "signin", badge: "Signed in", title: "Signed in", subject }
  }
  if (eventType === "login_failed") {
    return { category: "signin", badge: "Failed sign-in", title: "Failed sign-in", subject }
  }
  if (eventType === "logout") {
    return { category: "signin", badge: "Signed out", title: "Signed out", subject }
  }
  return {
    category: "signin",
    badge: "Password reset",
    title: "Password reset requested",
    subject,
  }
}

export const summarizeChange = (
  tableName: string,
  action: AuditAction,
  oldData: Json | null,
  newData: Json | null,
): ActivitySummary => {
  const oldRow = asRecord(oldData)
  const newRow = asRecord(newData)
  const category: Exclude<ActivityFilter, "all"> = isLibraryTable(tableName)
    ? "library"
    : isDocketTable(tableName)
      ? "docket"
      : "access"
  const badge = TABLE_LABELS[tableName as InstitutionalAuditTable] ?? tableName

  if (tableName === "profiles") {
    const who = personLabel(newRow) ?? personLabel(oldRow)
    if (action === "insert") {
      return {
        category,
        badge,
        title: `Account created (${asText(newRow.role) ?? "unknown role"})`,
        subject: who,
      }
    }
    if (action === "delete") {
      return { category, badge, title: "Account removed", subject: who }
    }
    if (asText(oldRow.role) && asText(newRow.role) && oldRow.role !== newRow.role) {
      return {
        category,
        badge,
        title: `Role changed from ${asText(oldRow.role)} to ${asText(newRow.role)}`,
        subject: who,
      }
    }
    if (oldRow.is_active === true && newRow.is_active === false) {
      return { category, badge, title: "Account deactivated", subject: who }
    }
    if (oldRow.is_active === false && newRow.is_active === true) {
      return { category, badge, title: "Account reactivated", subject: who }
    }
    if (asText(oldRow.email) && asText(newRow.email) && oldRow.email !== newRow.email) {
      return { category, badge, title: "Login email changed", subject: who }
    }
    return { category, badge, title: "Account updated", subject: who }
  }

  if (tableName === "magistrate_courts") {
    if (action === "insert") {
      return { category, badge, title: "Magistrate assigned to a court", subject: null }
    }
    if (action === "delete" || (action === "update" && newRow.ended_at && !oldRow.ended_at)) {
      return { category, badge, title: "Court assignment ended", subject: null }
    }
    return { category, badge, title: "Court assignment updated", subject: null }
  }

  if (tableName === "magistrate_court_requests") {
    const status = asText(newRow.status) ?? asText(oldRow.status)
    if (action === "insert") {
      return { category, badge, title: "Court assignment requested", subject: null }
    }
    return {
      category,
      badge,
      title: status ? `Court request ${status}` : "Court request updated",
      subject: null,
    }
  }

  if (tableName === "clerk_courts") {
    if (action === "insert") {
      return { category, badge, title: "Clerk granted court access", subject: null }
    }
    if (action === "delete" || (action === "update" && newRow.ended_at && !oldRow.ended_at)) {
      return { category, badge, title: "Clerk court access ended", subject: null }
    }
    return { category, badge, title: "Clerk court access updated", subject: null }
  }

  if (tableName === "clerk_access_requests") {
    const status = asText(newRow.status) ?? asText(oldRow.status)
    if (action === "insert") {
      return { category, badge, title: "Clerk access requested", subject: null }
    }
    return {
      category,
      badge,
      title: status ? `Clerk request ${status}` : "Clerk request updated",
      subject: null,
    }
  }

  if (tableName === "shares") {
    if (action === "insert") {
      return {
        category,
        badge,
        title: `Share granted (${asText(newRow.permission) ?? "access"})`,
        subject: null,
      }
    }
    if (action === "update" && newRow.revoked_at && !oldRow.revoked_at) {
      return { category, badge, title: "Share revoked", subject: null }
    }
    return { category, badge, title: "Share updated", subject: null }
  }

  if (tableName === "docket_matter_assignments") {
    if (action === "insert") {
      return { category, badge, title: "Matter retained", subject: null }
    }
    if (action === "update" && newRow.ended_at && !oldRow.ended_at) {
      return { category, badge, title: "Retained assignment ended", subject: null }
    }
    return { category, badge, title: "Retained assignment updated", subject: null }
  }

  if (tableName === "statutes") {
    const title = asText(newRow.title) ?? asText(oldRow.title) ?? asText(newRow.code)
    if (action === "insert") {
      return { category, badge, title: title ? `Legislation added: ${title}` : "Legislation added", subject: title }
    }
    if (action === "delete") {
      return { category, badge, title: title ? `Legislation removed: ${title}` : "Legislation removed", subject: title }
    }
    const review = asText(newRow.review_status)
    if (review && review !== asText(oldRow.review_status)) {
      return { category, badge, title: `Legislation ${review}${title ? `: ${title}` : ""}`, subject: title }
    }
    return { category, badge, title: title ? `Legislation updated: ${title}` : "Legislation updated", subject: title }
  }

  if (tableName === "case_law") {
    const name = asText(newRow.case_name) ?? asText(oldRow.case_name)
    if (action === "insert") {
      return { category, badge, title: name ? `Case law added: ${name}` : "Case law added", subject: name }
    }
    if (action === "delete") {
      return { category, badge, title: name ? `Case law removed: ${name}` : "Case law removed", subject: name }
    }
    const review = asText(newRow.review_status)
    if (review && review !== asText(oldRow.review_status)) {
      return { category, badge, title: `Case law ${review}${name ? `: ${name}` : ""}`, subject: name }
    }
    return { category, badge, title: name ? `Case law updated: ${name}` : "Case law updated", subject: name }
  }

  if (tableName === "documents") {
    const fileName = asText(newRow.file_name) ?? asText(oldRow.file_name)
    if (action === "insert") {
      return {
        category,
        badge,
        title: fileName ? `Document uploaded: ${fileName}` : "Document uploaded",
        subject: fileName,
      }
    }
    if (action === "delete") {
      return {
        category,
        badge,
        title: fileName ? `Document deleted: ${fileName}` : "Document deleted",
        subject: fileName,
      }
    }
    return { category, badge, title: "Document updated", subject: fileName }
  }

  if (tableName === "docket_matters") {
    const caseNumber = asText(newRow.case_number) ?? asText(oldRow.case_number)
    const title = asText(newRow.matter_title) ?? asText(oldRow.matter_title)
    const subject = [caseNumber, title].filter(Boolean).join(" · ") || null
    if (action === "insert") {
      return { category, badge, title: subject ? `Docket matter created: ${subject}` : "Docket matter created", subject }
    }
    if (action === "delete") {
      return {
        category,
        badge,
        title: subject ? `Docket matter permanently deleted: ${subject}` : "Docket matter permanently deleted",
        subject,
      }
    }
    if (!oldRow.deleted_at && newRow.deleted_at) {
      return { category, badge, title: subject ? `Moved to bin: ${subject}` : "Moved to bin", subject }
    }
    if (oldRow.deleted_at && !newRow.deleted_at) {
      return { category, badge, title: subject ? `Restored from bin: ${subject}` : "Restored from bin", subject }
    }
    const identityChanges = [
      oldRow.case_number !== newRow.case_number ? "case number" : null,
      oldRow.matter_title !== newRow.matter_title ? "title" : null,
      oldRow.charge_or_issue !== newRow.charge_or_issue ? "charge" : null,
    ].filter(Boolean)
    if (identityChanges.length > 0) {
      return {
        category,
        badge,
        title: `Matter ${identityChanges.join(", ")} updated`,
        subject,
      }
    }
    return { category, badge, title: subject ? `Docket matter updated: ${subject}` : "Docket matter updated", subject }
  }

  const verb = action === "insert" ? "added" : action === "delete" ? "removed" : "updated"
  return { category, badge, title: `${badge} ${verb}`, subject: null }
}

export const changedFields = (
  oldData: Json | null,
  newData: Json | null,
): FieldChange[] => {
  const oldRow = asRecord(oldData)
  const newRow = asRecord(newData)
  const keys = new Set([...Object.keys(oldRow), ...Object.keys(newRow)])
  const changes: FieldChange[] = []
  keys.forEach((key) => {
    if (HIDDEN_DETAIL_KEYS.has(key)) return
    if (key === "updated_at" || key === "search_vector") return
    const from = oldRow[key]
    const to = newRow[key]
    if (JSON.stringify(from) === JSON.stringify(to)) return
    if (from !== null && typeof from === "object") return
    if (to !== null && typeof to === "object") return
    changes.push({
      label: key.replace(/_/g, " "),
      from: displayValue(from),
      to: displayValue(to),
    })
  })
  return changes
}

export const actorDisplayName = (
  profile: { full_name: string | null; email: string } | null,
  fallbackEmail?: string | null,
): string => {
  if (profile?.full_name?.trim()) return profile.full_name.trim()
  if (profile?.email) return profile.email
  if (fallbackEmail?.trim()) return fallbackEmail.trim()
  return "Unknown"
}

export const matchesActivityQuery = (
  query: string,
  parts: Array<string | null | undefined>,
): boolean => {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return parts.some((part) => (part ?? "").toLowerCase().includes(needle))
}
