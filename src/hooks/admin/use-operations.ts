import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { supabase } from "@/lib/supabase"
import type { Json, Tables } from "@/types/database.types"

export const operationsKeys = {
  retention: ["admin", "retention"] as const,
  webhooks: ["admin", "webhooks"] as const,
  outbox: ["admin", "webhook-outbox"] as const,
}

export function useRetentionPolicies() {
  return useQuery({
    queryKey: operationsKeys.retention,
    queryFn: async (): Promise<Tables<"data_retention_policies">[]> => {
      const { data, error } = await supabase
        .from("data_retention_policies")
        .select("table_name, retention_days, action, notes, updated_at, updated_by")
        .order("table_name")
      if (error) throw error
      return data ?? []
    },
  })
}

export function useUpdateRetentionPolicy() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      tableName: string
      retentionDays: number
      action: string
    }) => {
      const { error } = await supabase
        .from("data_retention_policies")
        .update({
          retention_days: input.retentionDays,
          action: input.action,
        })
        .eq("table_name", input.tableName)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: operationsKeys.retention })
      toast.success("Retention policy saved")
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not save that policy")
    },
  })
}

export function useWebhookEndpoints() {
  return useQuery({
    queryKey: operationsKeys.webhooks,
    queryFn: async (): Promise<Tables<"webhook_endpoints">[]> => {
      const { data, error } = await supabase
        .from("webhook_endpoints")
        .select("id, url, secret, events, active, court_id, created_at, updated_at, created_by")
        .order("created_at", { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })
}

export function useWebhookOutbox() {
  return useQuery({
    queryKey: operationsKeys.outbox,
    queryFn: async (): Promise<Tables<"webhook_outbox">[]> => {
      const { data, error } = await supabase
        .from("webhook_outbox")
        .select("id, endpoint_id, event, payload, status, attempts, last_error, created_at, delivered_at")
        .order("created_at", { ascending: false })
        .limit(50)
      if (error) throw error
      return data ?? []
    },
  })
}

export function useCreateWebhookEndpoint() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { url: string; secret: string; events: string[] }) => {
      const { error } = await supabase.from("webhook_endpoints").insert({
        url: input.url,
        secret: input.secret,
        events: input.events,
        active: true,
      })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: operationsKeys.webhooks })
      toast.success("Webhook endpoint added")
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not add that endpoint")
    },
  })
}

export function useToggleWebhookEndpoint() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from("webhook_endpoints")
        .update({ active: input.active })
        .eq("id", input.id)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: operationsKeys.webhooks })
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not update that endpoint")
    },
  })
}

export function useDownloadMyData() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("download_my_data")
      if (error) throw error
      return data as Json
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not export your data")
    },
  })
}

export function useVerifyAuditHashChain() {
  return useQuery({
    queryKey: ["admin", "audit-hash-chain"] as const,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("verify_audit_hash_chain")
      if (error) throw error
      return data?.[0] ?? { ok: false, broken_id: null }
    },
  })
}
