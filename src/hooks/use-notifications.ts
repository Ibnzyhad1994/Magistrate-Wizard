import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import { QUERY_STALE_TIME_MS } from "@/lib/constants"
import type { Tables } from "@/types/database.types"

export type NotificationRow = Tables<"notifications">

export const notificationKeys = {
  all: ["notifications"] as const,
}

export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.all,
    queryFn: async (): Promise<NotificationRow[]> => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, user_id, type, title, body, link, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(100)
      if (error) throw error
      return data ?? []
    },
    staleTime: QUERY_STALE_TIME_MS,
    refetchInterval: 60_000,
  })
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all })
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not mark that notice as read")
    },
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all })
      toast.success("All notices marked as read")
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not mark notices as read")
    },
  })
}
