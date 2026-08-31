import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

/**
 * Self-service surface: a magistrate's (or an admin who is also a sitting
 * magistrate's) own court-assignment requests, every status, independently.
 * All reads go through RLS (magistrate_court_requests SELECT: own rows);
 * every write goes through the narrow SECURITY DEFINER RPCs (0107/0108) --
 * there is no direct client path to set status/reviewer/decision fields,
 * or to touch anyone else's request or assignment.
 */

export interface MagistrateCourtRequestRow {
  id: string;
  court_id: string;
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
  staff_id: string | null;
  note: string | null;
  requested_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
  approval_kind: "ordinary" | "bootstrap_self_approval" | null;
  courts: { id: string; name: string; jurisdiction: string } | null;
}

export interface MyMagistrateCourtAssignment {
  id: string;
  court_id: string;
  assignment_type: string;
  started_at: string;
  courts: { id: string; name: string; jurisdiction: string; magisterial_districts: { name: string } | null } | null;
}

export interface CourtForMagistrateRequest {
  id: string;
  name: string;
  district_id: string | null;
  status: "inactive" | "assigned_to_you" | "pending" | "assigned" | "available";
}

export const magistrateCourtRequestKeys = {
  myRequests: ["magistrate-court-requests", "my-requests"] as const,
  courtsForRequest: ["magistrate-court-requests", "courts"] as const,
};

/** Every one of the signed-in caller's own requests, any status, most recent first. */
export function useMyMagistrateCourtRequests() {
  const { user } = useAuth();
  return useQuery({
    queryKey: magistrateCourtRequestKeys.myRequests,
    queryFn: async (): Promise<MagistrateCourtRequestRow[]> => {
      const { data, error } = await supabase
        .from("magistrate_court_requests")
        .select(
          "id, court_id, status, staff_id, note, requested_at, reviewed_at, rejection_reason, approval_kind, courts(id, name, jurisdiction)",
        )
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data as unknown as MagistrateCourtRequestRow[];
    },
    enabled: !!user,
  });
}

/**
 * The signed-in caller's own current magistrate_courts rows, WITH the
 * row id/assignment_type/started_at that useMyCurrentCourts() (docket/
 * use-lookups.ts) deliberately omits -- needed here for the relinquish
 * confirmation dialog (spec requires showing court/district/start date/
 * assignment type before confirming). Magistrate-only; an admin who also
 * holds an assignment sees it here too, since RLS on magistrate_courts
 * SELECT is self-or-admin.
 */
export function useMyMagistrateCourtAssignments() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["magistrate-court-requests", "my-assignments"],
    queryFn: async (): Promise<MyMagistrateCourtAssignment[]> => {
      const { data, error } = await supabase
        .from("magistrate_courts")
        .select(
          "id, court_id, assignment_type, started_at, courts(id, name, jurisdiction, magisterial_districts(name))",
        )
        .eq("profile_id", user!.id)
        .is("ended_at", null)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data as unknown as MyMagistrateCourtAssignment[];
    },
    enabled: !!user,
    staleTime: 15_000,
  });
}

/** Every active-or-inactive court with a status personalized to the caller. */
export function useCourtsForMagistrateRequest() {
  const { user } = useAuth();
  return useQuery({
    queryKey: magistrateCourtRequestKeys.courtsForRequest,
    queryFn: async (): Promise<CourtForMagistrateRequest[]> => {
      const { data, error } = await supabase.rpc("list_courts_for_magistrate_request");
      if (error) throw error;
      return data as CourtForMagistrateRequest[];
    },
    enabled: !!user,
    staleTime: 15_000,
  });
}

function invalidateAfterAssignmentChange(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: magistrateCourtRequestKeys.myRequests });
  void queryClient.invalidateQueries({ queryKey: magistrateCourtRequestKeys.courtsForRequest });
  void queryClient.invalidateQueries({ queryKey: ["magistrate-court-requests", "my-assignments"] });
  void queryClient.invalidateQueries({ queryKey: ["docket", "my-current-courts"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard", "current-courts"] });
}

/** Request a new primary court assignment. Always a new, independent request. */
export function useSubmitMagistrateCourtRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { courtId: string; staffId?: string; note?: string }) => {
      const { data, error } = await supabase.rpc("submit_magistrate_court_request", {
        p_court_id: input.courtId,
        p_staff_id: input.staffId ?? undefined,
        p_note: input.note ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Court assignment request submitted.");
      invalidateAfterAssignmentChange(queryClient);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

/** Cancel one of the caller's own still-pending requests. */
export function useCancelMagistrateCourtRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (requestId: string) => {
      const { data, error } = await supabase.rpc("cancel_magistrate_court_request", {
        p_request_id: requestId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Request cancelled.");
      invalidateAfterAssignmentChange(queryClient);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

/**
 * Relinquish one of the caller's own active court assignments. Serves
 * both self-relinquishment and (elsewhere) admin-authorized ending --
 * see relinquish_magistrate_court() (0108).
 */
export function useRelinquishMagistrateCourt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { assignmentId: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("relinquish_magistrate_court", {
        p_assignment_id: input.assignmentId,
        p_reason: input.reason ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Court assignment relinquished.");
      invalidateAfterAssignmentChange(queryClient);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}
