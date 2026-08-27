import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";
import { notifyClerkAccess } from "@/hooks/clerk/use-clerk-access";

/**
 * Magistrate-side review surface: every access request and every clerk
 * roster row for a court the signed-in magistrate is currently authorized
 * to manage (can_manage_clerk_access(), 0086) -- RLS itself is what scopes
 * this to "my courts only" (clerk_access_requests/clerk_courts SELECT
 * policies, 0087/0088), not client-side filtering.
 */

export interface ClerkRequestForReview {
  id: string;
  court_id: string;
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
  staff_id: string | null;
  note: string | null;
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  courts: { id: string; name: string; jurisdiction: string } | null;
  profiles: { id: string; full_name: string | null; email: string } | null;
}

export interface ClerkRosterRow {
  id: string;
  profile_id: string;
  court_id: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  courts: { id: string; name: string; jurisdiction: string } | null;
  profiles: { id: string; full_name: string | null; email: string } | null;
}

export const clerkReviewKeys = {
  requests: ["clerk-access-review", "requests"] as const,
  roster: ["clerk-access-review", "roster"] as const,
};

/**
 * profiles' own SELECT RLS is self-or-admin only, so an ordinary (non-
 * admin) magistrate's embedded/joined read of the requesting clerk's name
 * and email would silently come back empty via a plain PostgREST embed —
 * confirmed by live testing. clerk_profiles_for_review() (0096) is a
 * narrow, purpose-built lookup scoped to exactly this legitimate need
 * (a clerk with a request/assignment at a court the caller manages), so
 * this enriches the base rows with a second call instead.
 */
async function enrichWithClerkProfiles<T extends { profile_id: string }>(
  rows: T[],
): Promise<(T & { profiles: { id: string; full_name: string | null; email: string } | null })[]> {
  if (rows.length === 0) return [];
  const profileIds = [...new Set(rows.map((r) => r.profile_id))];
  const { data: profiles, error } = await supabase.rpc("clerk_profiles_for_review", {
    p_profile_ids: profileIds,
  });
  if (error) throw error;
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, profiles: byId.get(r.profile_id) ?? null }));
}

/** Every access request (any status) for a court the caller currently manages. */
export function useClerkAccessRequestsToReview() {
  return useQuery({
    queryKey: clerkReviewKeys.requests,
    queryFn: async (): Promise<ClerkRequestForReview[]> => {
      const { data, error } = await supabase
        .from("clerk_access_requests")
        .select(
          "id, profile_id, court_id, status, staff_id, note, requested_at, reviewed_at, reviewed_by, rejection_reason, courts(id, name, jurisdiction)",
        )
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return (await enrichWithClerkProfiles(data ?? [])) as unknown as ClerkRequestForReview[];
    },
  });
}

/** Every clerk_courts row (active AND historical) for a court the caller currently manages. */
export function useClerkRoster() {
  return useQuery({
    queryKey: clerkReviewKeys.roster,
    queryFn: async (): Promise<ClerkRosterRow[]> => {
      const { data, error } = await supabase
        .from("clerk_courts")
        .select("id, profile_id, court_id, started_at, ended_at, end_reason, courts(id, name, jurisdiction)")
        .order("started_at", { ascending: false });
      if (error) throw error;
      return (await enrichWithClerkProfiles(data ?? [])) as unknown as ClerkRosterRow[];
    },
  });
}

export function useDecideClerkAccessRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; decision: "approved" | "rejected"; rejectionReason?: string }) => {
      const { data, error } = await supabase.rpc("decide_clerk_access_request", {
        p_request_id: input.requestId,
        p_decision: input.decision,
        p_rejection_reason: input.rejectionReason ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(data.status === "approved" ? "Access approved." : "Request rejected.");
      void queryClient.invalidateQueries({ queryKey: clerkReviewKeys.requests });
      void queryClient.invalidateQueries({ queryKey: clerkReviewKeys.roster });
      void notifyClerkAccess("decision_made", data.id);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useRevokeClerkCourtAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { assignmentId: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("revoke_clerk_court_access", {
        p_assignment_id: input.assignmentId,
        p_reason: input.reason ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Clerk access revoked.");
      void queryClient.invalidateQueries({ queryKey: clerkReviewKeys.roster });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

/** Admin-only fallback: verified, still-pending requests whose court has no magistrate currently able to review them. */
export function useOrphanedClerkAccessRequests() {
  return useQuery({
    queryKey: ["clerk-access-review", "orphaned"],
    queryFn: async (): Promise<ClerkRequestForReview[]> => {
      const { data, error } = await supabase.rpc("list_clerk_access_requests_needing_admin_attention");
      if (error) throw error;
      // The RPC returns bare clerk_access_requests rows (no embeds) --
      // enrich with court/clerk names for a usable admin screen.
      const rows = data ?? [];
      if (rows.length === 0) return [];
      const courtIds = [...new Set(rows.map((r) => r.court_id))];
      const profileIds = [...new Set(rows.map((r) => r.profile_id))];
      const [{ data: courts }, { data: profiles }] = await Promise.all([
        supabase.from("courts").select("id, name, jurisdiction").in("id", courtIds),
        supabase.from("profiles").select("id, full_name, email").in("id", profileIds),
      ]);
      const courtById = new Map((courts ?? []).map((c) => [c.id, c]));
      const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
      return rows.map((r) => ({
        ...r,
        courts: courtById.get(r.court_id) ?? null,
        profiles: profileById.get(r.profile_id) ?? null,
      })) as unknown as ClerkRequestForReview[];
    },
  });
}
