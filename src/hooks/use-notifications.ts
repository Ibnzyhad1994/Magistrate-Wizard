import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { QUERY_STALE_TIME_MS } from "@/lib/constants"
import type { Tables } from "@/types/database.types"

export type NotificationRow = Tables<"notifications">

/** Rows fetched per page. "Load more" raises the requested limit by this much. */
export const NOTIFICATIONS_PAGE_SIZE = 50

export const notificationKeys = {
  all: ["notifications"] as const,
  page: (limit: number) => ["notifications", "page", limit] as const,
  unreadCount: ["notifications", "unread-count"] as const,
}

export interface NotificationsPage {
  rows: NotificationRow[]
  /** True total for this user, independent of `limit` — so the UI can say when it's showing a subset. */
  totalCount: number
  hasMore: boolean
}

export function useNotifications(limit: number = NOTIFICATIONS_PAGE_SIZE) {
  return useQuery({
    queryKey: notificationKeys.page(limit),
    queryFn: async (): Promise<NotificationsPage> => {
      const { data, error, count } = await supabase
        .from("notifications")
        .select("id, user_id, type, title, body, link, read_at, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(limit)
      if (error) throw error
      const rows = data ?? []
      const totalCount = count ?? rows.length
      return { rows, totalCount, hasMore: totalCount > rows.length }
    },
    staleTime: QUERY_STALE_TIME_MS,
    refetchInterval: 60_000,
    // "Load more" raises the limit, which is part of the key — without
    // this the whole list would blank to a skeleton on every expansion.
    placeholderData: (previousData) => previousData,
  })
}

/**
 * Unread count for the nav badge. A dedicated `head`-style count rather
 * than deriving it from the fetched page: the list is paginated, so a
 * derived figure would silently under-report once a user has more unread
 * notices than the current page holds. Transfers no rows.
 */
export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null)
      if (error) throw error
      return count ?? 0
    },
    staleTime: QUERY_STALE_TIME_MS,
    refetchInterval: 60_000,
    // The badge is decoration on every page — a transient failure to
    // count should never surface a toast over whatever the user is doing.
    meta: { silent: true },
  })
}

/** Invalidate every notification-derived query: the paged list and the badge count. */
function invalidateNotifications(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: notificationKeys.all })
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null)
      if (error) throw error
    },
    // Optimistic: marking read is a trivially reversible, low-stakes act,
    // and waiting for a round-trip made the click feel unregistered on a
    // slow connection.
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all })
      const previous = queryClient.getQueriesData({ queryKey: notificationKeys.all })
      const now = new Date().toISOString()

      queryClient.setQueriesData<NotificationsPage>(
        { queryKey: notificationKeys.all },
        (old) =>
          old && Array.isArray(old.rows)
            ? {
                ...old,
                rows: old.rows.map((row) =>
                  row.id === id && row.read_at === null ? { ...row, read_at: now } : row,
                ),
              }
            : old,
      )
      queryClient.setQueryData<number>(notificationKeys.unreadCount, (old) =>
        typeof old === "number" ? Math.max(0, old - 1) : old,
      )

      return { previous }
    },
    onError: (error: Error, _id, context) => {
      for (const [key, value] of context?.previous ?? []) {
        queryClient.setQueryData(key, value)
      }
      toast.error(error.message || "Could not mark that notice as read")
    },
    onSettled: () => invalidateNotifications(queryClient),
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .is("read_at", null)
      if (error) throw error
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all })
      const previous = queryClient.getQueriesData({ queryKey: notificationKeys.all })
      const now = new Date().toISOString()

      queryClient.setQueriesData<NotificationsPage>(
        { queryKey: notificationKeys.all },
        (old) =>
          old && Array.isArray(old.rows)
            ? {
                ...old,
                rows: old.rows.map((row) => (row.read_at === null ? { ...row, read_at: now } : row)),
              }
            : old,
      )
      queryClient.setQueryData<number>(notificationKeys.unreadCount, 0)

      return { previous }
    },
    onError: (error: Error, _vars, context) => {
      for (const [key, value] of context?.previous ?? []) {
        queryClient.setQueryData(key, value)
      }
      toast.error(error.message || "Could not mark notices as read")
    },
    onSuccess: () => {
      toast.success("All notices marked as read")
    },
    onSettled: () => invalidateNotifications(queryClient),
  })
}
