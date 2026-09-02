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

const fetchChangeRows = async (filter: ActivityFilter): Promise<ChangeActivityRow[]> => {
  const tables = tablesForFilter(filter)
  if (tables.length === 0) return []
  const { data, error } = await supabase
    .from("audit_log")
    .select(
      "id, action, table_name, old_data, new_data, created_at, profiles!audit_log_actor_id_fkey(full_name, email)",
    )
    .in("table_name", [...tables])
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE)
  if (error) throw error
  return (data ?? []).map((row) => ({
    kind: "change" as const,
    id: `change:${row.id}`,
    createdAt: row.created_at,
    action: row.action,
    tableName: row.table_name,
    oldData: row.old_data,
    newData: row.new_data,
    actor: (row.profiles as ProfileRef) ?? null,
  }))
}

const fetchAuthRows = async (filter: ActivityFilter): Promise<AuthActivityRow[]> => {
  if (filter === "access" || filter === "library" || filter === "docket") return []
  const { data, error } = await supabase
    .from("auth_event_log")
    .select(
      "id, event_type, email, user_agent, created_at, profiles!auth_event_log_actor_id_fkey(full_name, email)",
    )
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE)
  if (error) throw error
  return (data ?? []).map((row) => ({
    kind: "auth" as const,
    id: `auth:${row.id}`,
    createdAt: row.created_at,
    eventType: row.event_type,
    email: row.email,
    userAgent: row.user_agent,
    actor: (row.profiles as ProfileRef) ?? null,
  }))
}

/**
 * Institutional change events plus the thin sign-on trail. Relies on
 * admin-only RLS on audit_log and auth_event_log — this hook is only
 * mounted behind ProtectedRoute allowedRoles={["admin"]}.
 */
export const useAuditActivity = (filter: ActivityFilter) =>
  useQuery({
    queryKey: auditActivityKeys.filter(filter),
    queryFn: async (): Promise<ActivityRow[]> => {
      const [changes, auths] = await Promise.all([
        fetchChangeRows(filter),
        fetchAuthRows(filter),
      ])
      return [...changes, ...auths].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
      )
    },
  })

