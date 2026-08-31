import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";

/**
 * Court Assignment Administrator review surface. RLS on
 * magistrate_court_requests already scopes SELECT to an admin's full,
 * email-confirmed-only visibility (0106) -- this hook adds only the
 * join/shape convenience on top. Every write goes through the SECURITY
 * DEFINER RPCs (0107) -- decide_magistrate_court_request() unconditionally
 * blocks self-approval; admin_bootstrap_self_approve_magistrate_court_request()
 * is the separately-gated sole-administrator exception.
 */

export interface MagistrateRequestForReview {
  id: string;
  profile_id: string;
  court_id: string;
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
  staff_id: string | null;
  note: string | null;
  requested_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
  approval_kind: "ordinary" | "bootstrap_self_approval" | null;
  profiles: { full_name: string | null; email: string } | null;
  courts: { id: string; name: string; jurisdiction: string } | null;
}

export const magistrateCourtRequestAdminKeys = {
  requests: ["admin", "magistrate-court-requests"] as const,
  bootstrapAvailable: ["admin", "magistrate-court-requests", "bootstrap-available"] as const,
};

/** Every magistrate_court_requests row -- all courts, all statuses. Admin-visible via RLS. */
export function useMagistrateCourtRequestsToReview() {
  return useQuery({
    queryKey: magistrateCourtRequestAdminKeys.requests,
    queryFn: async (): Promise<MagistrateRequestForReview[]> => {
      const { data, error } = await supabase
        .from("magistrate_court_requests")
        .select(
          "id, profile_id, court_id, status, staff_id, note, requested_at, reviewed_at, rejection_reason, approval_kind, profiles!magistrate_court_requests_profile_id_fkey(full_name, email), courts(id, name, jurisdiction)",
        )
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data as unknown as MagistrateRequestForReview[];
    },
  });
}

/**
 * Whether the sole-administrator bootstrap exception is currently
 * available to the caller at all (is_admin() AND exactly one active
 * administrator system-wide) -- UI guidance only, so the bootstrap
 * control is only ever rendered when it would actually succeed. The
 * approval RPC itself independently re-verifies this and more.
 */
export function useIsSoleAdminBootstrapAvailable() {
  return useQuery({
    queryKey: magistrateCourtRequestAdminKeys.bootstrapAvailable,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc("is_sole_admin_bootstrap_available");
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}

function invalidateAfterDecision(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: magistrateCourtRequestAdminKeys.requests });
  void queryClient.invalidateQueries({ queryKey: ["admin", "court-assignments"] });
}

/** Approve or reject a pending request. Never usable on the caller's own request. */
export function useDecideMagistrateCourtRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      requestId: string;
      decision: "approved" | "rejected";
      rejectionReason?: string;
    }) => {
      const { data, error } = await supabase.rpc("decide_magistrate_court_request", {
        p_request_id: input.requestId,
        p_decision: input.decision,
        p_rejection_reason: input.rejectionReason ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.decision === "approved" ? "Request approved." : "Request rejected.");
      invalidateAfterDecision(queryClient);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

/**
 * The explicit sole-administrator self-approval exception. The caller
 * is expected to have just re-authenticated (signInWithPassword)
 * immediately before this call -- the RPC independently enforces a
 * fresh-JWT check server-side regardless.
 */
export function useAdminBootstrapSelfApprove() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; reason: string }) => {
      const { data, error } = await supabase.rpc(
        "admin_bootstrap_self_approve_magistrate_court_request",
        { p_request_id: input.requestId, p_reason: input.reason },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Self-approval exception recorded and request approved.");
      invalidateAfterDecision(queryClient);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}
