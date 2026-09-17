import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { ShareItemType } from "@/lib/shares";

const key = (itemType: ShareItemType, itemId: string) => ["shares", itemType, itemId] as const;

interface ShareIdentityRow {
  share_id: string;
  recipient_id: string | null;
  recipient_display_name: string | null;
  granted_by: string | null;
  grantor_display_name: string | null;
}

/**
 * `resolve_docket_share_identities` (0155) resolves every share on an item
 * in one round trip — the per-row `resolve_docket_share_identity` call made
 * a matter with ten shares cost eleven requests. Same SECURITY DEFINER
 * envelope and per-row authority predicate as the singular RPC.
 *
 * `src/types/database.types.ts` is generated from the live schema and does
 * not yet carry 0155, so the call is typed here; collapse this back to a
 * plain `supabase.rpc(...)` once `supabase gen types` is re-run.
 */
const resolveShareIdentities = (ids: string[]) =>
  (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: ShareIdentityRow[] | null; error: { message: string } | null }>
  )("resolve_docket_share_identities", { p_share_ids: ids });

export interface ResolvedShare {
  id: string;
  permission: string;
  created_at: string;
  revoked_at: string | null;
  recipient_id: string | null;
  recipient_display_name: string | null;
  granted_by: string | null;
  grantor_display_name: string | null;
}

export function useShares(itemType: ShareItemType, itemId: string | undefined) {
  return useQuery({
    queryKey: key(itemType, itemId ?? ""),
    queryFn: async (): Promise<ResolvedShare[]> => {
      const { data: shares, error } = await supabase
        .from("shares")
        .select("id, permission, created_at, revoked_at")
        .eq("item_type", itemType)
        .eq("item_id", itemId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (!shares || shares.length === 0) return [];

      const { data: identities, error: identityError } = await resolveShareIdentities(
        shares.map((share) => share.id),
      );
      if (identityError) throw identityError;
      const byShare = new Map((identities ?? []).map((row) => [row.share_id, row]));
      return shares.map((share) => {
        const row = byShare.get(share.id);
        return {
          ...share,
          recipient_id: row?.recipient_id ?? null,
          recipient_display_name: row?.recipient_display_name ?? null,
          granted_by: row?.granted_by ?? null,
          grantor_display_name: row?.grantor_display_name ?? null,
        };
      });
    },
    enabled: !!itemId,
  });
}

export interface ResolvedRecipient {
  profile_id: string;
  display_name: string | null;
}

export function useResolveShareRecipient(itemType: ShareItemType, itemId: string) {
  return useMutation({
    mutationFn: async (email: string): Promise<ResolvedRecipient | null> => {
      if (itemType === "docket_matter") {
        const { data, error } = await supabase.rpc("resolve_docket_share_recipient", {
          p_docket_matter_id: itemId,
          p_email: email,
        });
        if (error) throw error;
        return data?.[0] ?? null;
      }
      const { data, error } = await supabase.rpc("resolve_item_share_recipient", {
        p_item_type: itemType,
        p_item_id: itemId,
        p_email: email,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

export function useCreateShare(itemType: ShareItemType, itemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      recipientId,
      permission,
    }: {
      recipientId: string;
      permission: "view" | "edit";
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { error } = await supabase.from("shares").insert({
        item_type: itemType,
        item_id: itemId,
        recipient_id: recipientId,
        granted_by: user.id,
        permission,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Shared.");
      void queryClient.invalidateQueries({ queryKey: key(itemType, itemId) });
      if (itemType === "docket_matter") {
        void queryClient.invalidateQueries({ queryKey: ["docket-matter-access", itemId] });
      }
    },
  });
}

export function useRevokeShare(itemType: ShareItemType, itemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("shares")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Share revoked.");
      void queryClient.invalidateQueries({ queryKey: key(itemType, itemId) });
      if (itemType === "docket_matter") {
        void queryClient.invalidateQueries({ queryKey: ["docket-matter-access", itemId] });
      }
    },
  });
}
