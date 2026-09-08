import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import type { Json } from "@/types/database.types"
import {
  type ActivityFilter,
  type AuthEventType,
  type AuditAction,
  tablesForFilter,
} from "@/lib/audit-activity"

type ProfileRef = { full_name: string | null; email: string } | null

export interface ChangeActivityRow {
  kind: "change"
  id: string
  createdAt: string
  action: AuditAction
  tableName: string
  oldData: Json | null
  newData: Json | null
  actor: ProfileRef
}

export interface AuthActivityRow {
  kind: "auth"
  id: string
  createdAt: string
  eventType: AuthEventType
  email: string | null
  userAgent: string | null
  actor: ProfileRef
}

export type ActivityRow = ChangeActivityRow | AuthActivityRow

export const auditActivityKeys = {
  all: ["admin", "audit-activity"] as const,
  filter: (filter: ActivityFilter) => [...auditActivityKeys.all, filter] as const,
}

const PAGE_SIZE = 200

const fetchChangeRows = async (
  filter: ActivityFilter,
): Promise<{ rows: ChangeActivityRow[]; total: number }> => {
  const tables = tablesForFilter(filter)
  if (tables.length === 0) return { rows: [], total: 0 }
  const { data, error, count } = await supabase
    .from("audit_log")
    .select(
      "id, action, table_name, old_data, new_data, created_at, profiles!audit_log_actor_id_fkey(full_name, email)",
      { count: "exact" },
    )
    .in("table_name", [...tables])
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE)
  if (error) throw error
  return {
    rows: (data ?? []).map((row) => ({
      kind: "change" as const,
      id: `change:${row.id}`,
      createdAt: row.created_at,
      action: row.action,
      tableName: row.table_name,
      oldData: row.old_data,
      newData: row.new_data,
      actor: (row.profiles as ProfileRef) ?? null,
    })),
    total: count ?? (data ?? []).length,
  }
}

const fetchAuthRows = async (
  filter: ActivityFilter,
): Promise<{ rows: AuthActivityRow[]; total: number }> => {
  if (filter === "access" || filter === "library" || filter === "docket") {
    return { rows: [], total: 0 }
  }
  const { data, error, count } = await supabase
    .from("auth_event_log")
    .select(
      "id, event_type, email, user_agent, created_at, profiles!auth_event_log_actor_id_fkey(full_name, email)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE)
  if (error) throw error
  return {
    rows: (data ?? []).map((row) => ({
      kind: "auth" as const,
      id: `auth:${row.id}`,
      createdAt: row.created_at,
      eventType: row.event_type,
      email: row.email,
      userAgent: row.user_agent,
      actor: (row.profiles as ProfileRef) ?? null,
    })),
    total: count ?? (data ?? []).length,
  }
}

export interface AuditActivityResult {
  rows: ActivityRow[]
  /** True combined row count across both tables for this filter — independent of PAGE_SIZE, via a `count: "exact", head`-style request that transfers no extra rows. */
  totalCount: number
  /** True once `rows.length < totalCount` — the ledger has more than this page shows, so the on-screen list AND any CSV export of `rows` are both partial. */
  truncated: boolean
}

/**
 * Institutional change events plus the thin sign-on trail. Relies on
 * admin-only RLS on audit_log and auth_event_log — this hook is only
 * mounted behind ProtectedRoute allowedRoles={["admin"]}.
 */
export const useAuditActivity = (filter: ActivityFilter) =>
  useQuery({
    queryKey: auditActivityKeys.filter(filter),
    queryFn: async (): Promise<AuditActivityResult> => {
      const [changes, auths] = await Promise.all([
        fetchChangeRows(filter),
        fetchAuthRows(filter),
      ])
      const rows = [...changes.rows, ...auths.rows].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      )
      const totalCount = changes.total + auths.total
      return { rows, totalCount, truncated: rows.length < totalCount }
    },
  })

