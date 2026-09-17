import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/utils";
import type { Json, Tables } from "@/types/database.types";

export const operationsKeys = {
  retention: ["admin", "retention"] as const,
  webhooks: ["admin", "webhooks"] as const,
  outbox: ["admin", "webhook-outbox"] as const,
};

export function useRetentionPolicies() {
  return useQuery({
    queryKey: operationsKeys.retention,
    queryFn: async (): Promise<Tables<"data_retention_policies">[]> => {
      const { data, error } = await supabase
        .from("data_retention_policies")
        .select("table_name, retention_days, action, notes, updated_at, updated_by")
        .order("table_name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpdateRetentionPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { tableName: string; retentionDays: number; action: string }) => {
      const { error } = await supabase
        .from("data_retention_policies")
        .update({
          retention_days: input.retentionDays,
          action: input.action,
        })
        .eq("table_name", input.tableName);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: operationsKeys.retention });
      toast.success("Retention policy saved");
    },
    meta: { silent: true },
    onError: (error: Error) => {
      toast.error(error.message || "Could not save that policy");
    },
  });
}

/**
 * Deliberately omits `secret`. The HMAC signing key is only ever needed
 * when CREATING an endpoint (generated client-side, written once) — it is
 * never read back or displayed. Selecting it here put a live signing
 * secret into the React Query cache on every Operations page view for no
 * benefit at all.
 */
export type WebhookEndpointRow = Omit<Tables<"webhook_endpoints">, "secret">;

export function useWebhookEndpoints() {
  return useQuery({
    queryKey: operationsKeys.webhooks,
    queryFn: async (): Promise<WebhookEndpointRow[]> => {
      const { data, error } = await supabase
        .from("webhook_endpoints")
        .select("id, url, events, active, court_id, created_at, updated_at, created_by")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useWebhookOutbox() {
  return useQuery({
    queryKey: operationsKeys.outbox,
    queryFn: async (): Promise<Tables<"webhook_outbox">[]> => {
      const { data, error } = await supabase
        .from("webhook_outbox")
        .select(
          "id, endpoint_id, event, payload, status, attempts, last_error, created_at, delivered_at",
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateWebhookEndpoint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { url: string; secret: string; events: string[] }) => {
      const { data, error } = await supabase
        .from("webhook_endpoints")
        .insert({
          url: input.url,
          secret: input.secret,
          events: input.events,
          active: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      // Returned once so the page can show the secret it just generated;
      // later reads go through the audited reveal RPC below.
      return { id: data.id, secret: input.secret };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: operationsKeys.webhooks });
      toast.success("Webhook endpoint added");
    },
    meta: { silent: true },
    onError: (error: Error) => {
      toast.error(error.message || "Could not add that endpoint");
    },
  });
}

export function useToggleWebhookEndpoint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from("webhook_endpoints")
        .update({ active: input.active })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: operationsKeys.webhooks });
    },
    meta: { silent: true },
    onError: (error: Error) => {
      toast.error(error.message || "Could not update that endpoint");
    },
  });
}

/**
 * Admin-only, audited read of one endpoint's HMAC signing secret
 * (`reveal_webhook_secret`, 0156). Not a query: the secret must never sit
 * in the React Query cache, so it is fetched on demand and held only in
 * the component that asked for it.
 */
export function useRevealWebhookSecret() {
  return useMutation({
    mutationFn: async (endpointId: string): Promise<string> => {
      const { data, error } = await supabase.rpc("reveal_webhook_secret", {
        p_endpoint_id: endpointId,
      });
      if (error) throw error;
      return data;
    },
    onError: (error: Error) => {
      toast.error(getErrorMessage(error) || "Could not reveal that secret");
    },
    meta: { silent: true },
  });
}

/** Re-queues one failed outbox row (`retry_webhook_delivery`, 0156). */
export function useRetryWebhookDelivery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (outboxId: string): Promise<boolean> => {
      const { data, error } = await supabase.rpc("retry_webhook_delivery", {
        p_outbox_id: outboxId,
      });
      if (error) throw error;
      return Boolean(data);
    },
    onSuccess: (requeued) => {
      void queryClient.invalidateQueries({ queryKey: operationsKeys.outbox });
      if (requeued) toast.success("Delivery queued again");
      else toast.message("That row is no longer failed");
    },
    onError: (error: Error) => {
      toast.error(getErrorMessage(error) || "Could not retry that delivery");
    },
    meta: { silent: true },
  });
}

export function useDownloadMyData() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("download_my_data");
      if (error) throw error;
      return data as Json;
    },
    meta: { silent: true },
    onError: (error: Error) => {
      toast.error(getErrorMessage(error) || "Could not export your data");
    },
  });
}

export function useVerifyAuditHashChain() {
  return useQuery({
    queryKey: ["admin", "audit-hash-chain"] as const,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("verify_audit_hash_chain");
      if (error) throw error;
      return data?.[0] ?? { ok: false, broken_id: null };
    },
  });
}
