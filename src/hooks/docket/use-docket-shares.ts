import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

const key = (matterId: string) => ["docket-shares", matterId] as const;

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

/**
 * Docket Matter shares. Identity (recipient/grantor display name) is
 * resolved per-row via `resolve_docket_share_identity()` rather than a
 * broad `profiles` SELECT — `profiles` RLS is owner-or-admin only, so
 * that RPC is the only RLS-authorized way to display who a share
 * belongs to. Creating a new share resolves the recipient first via
 * `resolve_docket_share_recipient()` (0051 — exact, case-insensitive
 * email match, gated by the same authority the `shares` INSERT policy
 * itself checks) and only then inserts the Share row; the resolver
 * never discloses *why* a lookup failed (unauthorized caller, unknown
 * email, inactive recipient, and self-lookup all collapse to the same
 * empty result), so the UI must show one generic "no eligible
 * recipient" message rather than trying to distinguish the cause.
 */
export function useDocketShares(matterId: string | undefined) {
  return useQuery({
    queryKey: key(matterId ?? ""),
    queryFn: async (): Promise<ResolvedShare[]> => {
      const { data: shares, error } = await supabase
        .from("shares")
        .select("id, permission, created_at, revoked_at")
        .eq("item_type", "docket_matter")
        .eq("item_id", matterId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      if (!shares || shares.length === 0) return [];

      const resolved = await Promise.all(
        shares.map(async (share) => {
          const { data: identity, error: identityError } = await supabase.rpc(
            "resolve_docket_share_identity",
            { p_share_id: share.id },
          );
          if (identityError) throw identityError;
          const row = identity?.[0];
          return {
            ...share,
            recipient_id: row?.recipient_id ?? null,
            recipient_display_name: row?.recipient_display_name ?? null,
            granted_by: row?.granted_by ?? null,
            grantor_display_name: row?.grantor_display_name ?? null,
          };
        }),
      );
      return resolved;
    },
    enabled: !!matterId,
  });
}

export function useUpdateSharePermission(matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      permission,
    }: {
      id: string;
      permission: "view" | "edit";
    }) => {
      const { error } = await supabase
        .from("shares")
        .update({ permission })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Share permission updated.");
      void queryClient.invalidateQueries({ queryKey: key(matterId) });
    },
  });
}

export interface ResolvedRecipient {
  profile_id: string;
  display_name: string | null;
}

/**
 * Step 1 of share creation: resolve a proposed recipient by exact email.
 * Returns `null` for any failure (not authorized, unknown email, self,
 * inactive) — the RPC itself makes these indistinguishable, so this
 * hook does not attempt to either.
 */
export function useResolveShareRecipient(matterId: string) {
  return useMutation({
    mutationFn: async (email: string): Promise<ResolvedRecipient | null> => {
      const { data, error } = await supabase.rpc(
        "resolve_docket_share_recipient",
        { p_docket_matter_id: matterId, p_email: email },
      );
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

/** Step 2: create the Share once a recipient has been resolved. */
export function useCreateShare(matterId: string) {
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
        item_type: "docket_matter",
        item_id: matterId,
        recipient_id: recipientId,
        granted_by: user.id,
        permission,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Matter shared.");
      void queryClient.invalidateQueries({ queryKey: key(matterId) });
    },
  });
}

export function useRevokeShare(matterId: string) {
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
      void queryClient.invalidateQueries({ queryKey: key(matterId) });
    },
  });
}
