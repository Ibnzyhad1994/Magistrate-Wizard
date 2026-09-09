import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";

/**
 * Court Assignment Administrator review surface. RLS on
 * magistrate_court_requests scopes SELECT to the caller's own rows, or
 * every row when is_admin() (0115) -- this hook adds only the join/shape
 * convenience on top. Every write goes through the SECURITY DEFINER RPCs
 * (0107) -- decide_magistrate_court_request() unconditionally blocks
 * self-approval; admin_bootstrap_self_approve_magistrate_court_request()
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
  email_confirmed: boolean | null;
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
      const [requestsResult, confirmationResult] = await Promise.all([
        supabase
          .from("magistrate_court_requests")
          .select(
            "id, profile_id, court_id, status, staff_id, note, requested_at, reviewed_at, rejection_reason, approval_kind, profiles!magistrate_court_requests_profile_id_fkey(full_name, email), courts(id, name, jurisdiction)",
          )
          .order("requested_at", { ascending: false }),
        supabase.rpc("list_magistrate_court_request_email_confirmation"),
      ]);
      if (requestsResult.error) throw requestsResult.error;
      if (confirmationResult.error) throw confirmationResult.error;
      const confirmedById = new Map(
        (confirmationResult.data ?? []).map((row) => [row.request_id, row.email_confirmed]),
      );
      return (requestsResult.data as unknown as Omit<MagistrateRequestForReview, "email_confirmed">[]).map(
        (row) => ({
          ...row,
          email_confirmed: confirmedById.has(row.id) ? Boolean(confirmedById.get(row.id)) : null,
        }),
      );
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
  void queryClient.invalidateQueries({ queryKey: ["admin", "unassigned-magistrates"] });
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
      toast.success(
        variables.decision === "approved" ? "Request approved." : "Returned to requester.",
      );
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

function isMissingRpc(error: unknown): boolean {
  const message = getErrorMessage(error);
  return /schema cache|could not find the function/i.test(message);
}

async function rejectPendingRequestsForProfile(profileId: string, reason: string): Promise<number> {
  const { data: pending, error: listError } = await supabase
    .from("magistrate_court_requests")
    .select("id")
    .eq("profile_id", profileId)
    .eq("status", "pending");
  if (listError) throw listError;
  const rows = pending ?? [];
  for (const row of rows) {
    const { error } = await supabase.rpc("decide_magistrate_court_request", {
      p_request_id: row.id,
      p_decision: "rejected",
      p_rejection_reason: reason,
    });
    if (error) throw error;
  }
  return rows.length;
}

/**
 * Roster action: reject any still-open requests for an unassigned
 * magistrate and notify them to request the correct court. Does not
 * change their account role.
 *
 * Open requests use decide_magistrate_court_request() (present since
 * 0107) so returning a pending row still works on a preview database
 * that has not applied 0135 yet. The dedicated send-back RPC is only
 * required when there is no open request (notify-only).
 */
export function useReturnUnassignedMagistrate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { profileId: string; reason: string }) => {
      const closed = await rejectPendingRequestsForProfile(input.profileId, input.reason);
      if (closed > 0) return closed;

      const { data, error } = await supabase.rpc("return_unassigned_magistrate_to_requester", {
        p_profile_id: input.profileId,
        p_reason: input.reason,
      });
      if (!error) return data;
      if (isMissingRpc(error)) {
        throw new Error(
          "This database is missing migration 0135 (return_unassigned_magistrate_to_requester). Apply it on the preview Supabase project, then retry.",
        );
      }
      throw error;
    },
    onSuccess: (rejectedCount) => {
      toast.success(
        rejectedCount
          ? "Returned to requester. Open requests were closed and they were notified."
          : "Returned to requester. They were notified to request again.",
      );
      invalidateAfterDecision(queryClient);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

/**
 * Admin recovery for a magistrate/clerk signup mistake. Blocked when the
 * person already sits a court, when the target is the caller, or when
 * converting to/from admin — the RPC re-checks all of that.
 */
export function useCorrectUnassignedAccountType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      profileId: string;
      newRole: "magistrate" | "clerk";
      reason: string;
    }) => {
      const { data, error } = await supabase.rpc("correct_unassigned_account_type", {
        p_profile_id: input.profileId,
        p_new_role: input.newRole,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (newRole) => {
      toast.success(
        newRole === "clerk"
          ? "Account type corrected to Court Clerk. They were notified."
          : "Account type corrected to Magistrate. They were notified.",
      );
      invalidateAfterDecision(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["admin", "people"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "profile"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "clerk-courts"] });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}
