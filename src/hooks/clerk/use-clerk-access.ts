import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { sendClerkAccessNotice, type ClerkAccessNoticeEvent } from "@/lib/clerk-access-notify";

/**
 * Clerk-side self-service surface: a clerk's own access requests (every
 * status, every court, independently) and their own active court
 * assignments. All reads/writes here go through RLS (clerk_access_requests
 * SELECT: own rows) or the two narrow SECURITY DEFINER RPCs
 * (submit_clerk_access_request / cancel_clerk_access_request, 0088) --
 * there is no direct client path to set status/reviewer/decision fields.
 */

export interface ClerkAccessRequestRow {
  id: string;
  court_id: string;
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
  staff_id: string | null;
  note: string | null;
  requested_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
  notified_magistrate_at: string | null;
  courts: { id: string; name: string; jurisdiction: string } | null;
}

export const clerkAccessKeys = {
  myRequests: ["clerk-access", "my-requests"] as const,
  myCourts: ["clerk-access", "my-courts"] as const,
};

/**
 * Best-effort: asks the clerk-access-notify Edge Function to send the
 * relevant email. Never blocks or fails the caller's own action, and a
 * failed call is reported, not swallowed (see sendClerkAccessNotice).
 */
export function notifyClerkAccess(event: ClerkAccessNoticeEvent, requestId: string) {
  return sendClerkAccessNotice(supabase, event, requestId);
}

/** Every one of the signed-in clerk's own requests, any status, most recent first. */
export function useMyClerkAccessRequests() {
  const { user } = useAuth();
  return useQuery({
    queryKey: clerkAccessKeys.myRequests,
    queryFn: async (): Promise<ClerkAccessRequestRow[]> => {
      const { data, error } = await supabase
        .from("clerk_access_requests")
        .select(
          "id, court_id, status, staff_id, note, requested_at, reviewed_at, rejection_reason, notified_magistrate_at, courts(id, name, jurisdiction)",
        )
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data as unknown as ClerkAccessRequestRow[];
    },
    enabled: !!user,
  });
}

/** The signed-in clerk's currently-active (approved, not since revoked) court assignments. */
export function useMyClerkCourts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: clerkAccessKeys.myCourts,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clerk_courts")
        .select("id, court_id, started_at, courts(id, name, jurisdiction)")
        .is("ended_at", null)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}

/**
 * Lightweight existence check for route-gating (ProtectedRoute): does the
 * signed-in clerk have AT LEAST ONE currently-active court assignment?
 * Only ever queries for a clerk profile -- inert (query disabled) for any
 * other role, so this costs nothing for a magistrate.
 */
export function useHasApprovedClerkCourt() {
  const { profile } = useAuth();
  return useQuery({
    queryKey: ["clerk-access", "has-approved-court", profile?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("clerk_courts")
        .select("id", { count: "exact", head: true })
        .is("ended_at", null);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
    enabled: profile?.role === "clerk",
    staleTime: 15_000,
  });
}

/** Request access to one additional court. Always a new, independent request. */
export function useSubmitClerkAccessRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { courtId: string; staffId?: string; note?: string }) => {
      const { data, error } = await supabase.rpc("submit_clerk_access_request", {
        p_court_id: input.courtId,
        p_staff_id: input.staffId ?? undefined,
        p_note: input.note ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success("Access request submitted. The court's magistrate will review it.");
      void queryClient.invalidateQueries({ queryKey: clerkAccessKeys.myRequests });
      void notifyClerkAccess("request_created", data.id);
    },
    meta: { silent: true },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

/** Cancel one of the clerk's own still-pending requests. */
export function useCancelClerkAccessRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await supabase.rpc("cancel_clerk_access_request", {
        p_request_id: requestId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Request cancelled.");
      void queryClient.invalidateQueries({ queryKey: clerkAccessKeys.myRequests });
    },
    meta: { silent: true },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}
