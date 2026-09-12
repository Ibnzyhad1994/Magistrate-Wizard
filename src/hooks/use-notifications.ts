import { useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { useAuthStore } from "@/store/auth-store"
import { QUERY_STALE_TIME_MS } from "@/lib/constants"
import { notificationFilterKey, type NotificationFilter } from "@/lib/notification-filter"
import type { Tables } from "@/types/database.types"

export type NotificationRow = Tables<"notifications">
export type { NotificationFilter }

/** Rows fetched per page. "Load more" raises the requested limit by this much. */
export const NOTIFICATIONS_PAGE_SIZE = 50

/** Newest few shown in the bell's dropdown — a peek for triage, not the list. */
export const NOTIFICATION_PEEK_SIZE = 8

/**
 * Realtime carries new notices (0143), so polling is a fallback rather than
 * the mechanism. It is deliberately NOT removed: this runs in courthouses
 * whose networks may block or drop WebSockets, and a magistrate silently
 * never seeing a notice again would be a worse failure than a slow one.
 * Five minutes is frequent enough to self-heal a dropped socket and rare
 * enough not to matter.
 */
const NOTIFICATION_FALLBACK_POLL_MS = 5 * 60_000

export const notificationKeys = {
  all: ["notifications"] as const,
  page: (limit: number, filter?: NotificationFilter) =>
    ["notifications", "page", limit, notificationFilterKey(filter)] as const,
  unreadCount: ["notifications", "unread-count"] as const,
}

export interface NotificationsPage {
  rows: NotificationRow[]
  /** Total matching the CURRENT filter, independent of `limit` — so the UI can say when it's showing a subset. */
  totalCount: number
  hasMore: boolean
}

export function useNotifications(
  limit: number = NOTIFICATIONS_PAGE_SIZE,
  filter?: NotificationFilter,
  // The bell mounts on every authenticated page but only needs rows while
  // its dropdown is open; without this it would fetch a page on every
  // navigation just to render a count it gets from a separate query.
  options?: { enabled?: boolean },
) {
  return useQuery({
    enabled: options?.enabled ?? true,
    queryKey: notificationKeys.page(limit, filter),
    queryFn: async (): Promise<NotificationsPage> => {
      // Filtering is pushed to the server, not applied to the fetched page:
      // the list is paginated, so filtering client-side would only narrow
      // the rows already loaded and silently hide matching older ones.
      let query = supabase
        .from("notifications")
        .select("id, user_id, type, title, body, link, read_at, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .limit(limit)
      if (filter?.unreadOnly) query = query.is("read_at", null)
      if (filter?.types && filter.types.length > 0) query = query.in("type", filter.types)

      const { data, error, count } = await query
      if (error) throw error
      const rows = data ?? []
      const totalCount = count ?? rows.length
      return { rows, totalCount, hasMore: totalCount > rows.length }
    },
    staleTime: QUERY_STALE_TIME_MS,
    refetchInterval: NOTIFICATION_FALLBACK_POLL_MS,
    // "Load more" and changing a filter both change the key — without this
    // the whole list would blank to a skeleton on every such change.
    placeholderData: (previousData) => previousData,
  })
}

/**
 * Subscribes to this user's notification changes and refreshes the derived
 * queries when one lands.
 *
 * Invalidates rather than merging the payload into the cache: a realtime
 * row would have to be reconciled against whichever filter and limit each
 * mounted list is currently using, and getting that wrong shows a notice
 * in a filter it doesn't match. Invalidation is a round trip the user never
 * waits on, and it cannot desync.
 *
 * The server-side `filter` is scoped to this user's rows. RLS is what
 * actually enforces that (Supabase evaluates the SELECT policy per
 * subscriber, 0143) — this just avoids waking every client for traffic it
 * would discard.
 */
export function useNotificationsRealtime() {
  const queryClient = useQueryClient()
  const userId = useAuthStore((state) => state.user?.id)

  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: notificationKeys.all })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, queryClient])
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

/**
 * Puts a notice back to unread. Opening one by accident — or reading it on
 * the way to something else — otherwise permanently lost the only marker
 * for "come back to this". No migration was needed: notifications_protect()
 * (0123) pins every column except read_at precisely so this is possible.
 */
export function useMarkNotificationUnread() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: null })
        .eq("id", id)
        .not("read_at", "is", null)
      if (error) throw error
    },
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all })
      const previous = queryClient.getQueriesData({ queryKey: notificationKeys.all })

      queryClient.setQueriesData<NotificationsPage>(
        { queryKey: notificationKeys.all },
        (old) =>
          old && Array.isArray(old.rows)
            ? {
                ...old,
                rows: old.rows.map((row) =>
                  row.id === id && row.read_at !== null ? { ...row, read_at: null } : row,
                ),
              }
            : old,
      )
      queryClient.setQueryData<number>(notificationKeys.unreadCount, (old) =>
        typeof old === "number" ? old + 1 : old,
      )

      return { previous }
    },
    onError: (error: Error, _id, context) => {
      for (const [key, value] of context?.previous ?? []) {
        queryClient.setQueryData(key, value)
      }
      toast.error(error.message || "Could not mark that notice as unread")
    },
    onSettled: () => invalidateNotifications(queryClient),
  })
}

/**
 * Removes a notice from the list for good (0143's DELETE policy, scoped to
 * the caller's own rows).
 *
 * "Mark read" only dims a row; there was previously no way to clear one at
 * all, so the list grew until the 90-day retention purge (0127). Dismissing
 * affects only the notice — the request, hearing, or share it points at is
 * untouched and still reachable from its own page, which is why this needs
 * no confirmation step.
 */
export function useDismissNotification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").delete().eq("id", id)
      if (error) throw error
    },
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all })
      const previous = queryClient.getQueriesData({ queryKey: notificationKeys.all })

      // Whether this changes the badge depends on the row we are removing,
      // so read it out of the cache before dropping it.
      let wasUnread = false
      for (const [, value] of previous) {
        const page = value as NotificationsPage | undefined
        const hit = page?.rows?.find((row) => row.id === id)
        if (hit) {
          wasUnread = hit.read_at === null
          break
        }
      }

      queryClient.setQueriesData<NotificationsPage>(
        { queryKey: notificationKeys.all },
        (old) => {
          if (!old || !Array.isArray(old.rows)) return old
          const rows = old.rows.filter((row) => row.id !== id)
          if (rows.length === old.rows.length) return old
          const totalCount = Math.max(0, old.totalCount - 1)
          return { ...old, rows, totalCount, hasMore: totalCount > rows.length }
        },
      )
      if (wasUnread) {
        queryClient.setQueryData<number>(notificationKeys.unreadCount, (old) =>
          typeof old === "number" ? Math.max(0, old - 1) : old,
        )
      }

      return { previous }
    },
    onError: (error: Error, _id, context) => {
      for (const [key, value] of context?.previous ?? []) {
        queryClient.setQueryData(key, value)
      }
      toast.error(error.message || "Could not dismiss that notice")
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
