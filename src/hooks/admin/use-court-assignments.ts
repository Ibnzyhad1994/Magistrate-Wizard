import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";
import type { Database } from "@/types/database.types";

export interface ProfileSearchResult {
  id: string;
  full_name: string | null;
  email: string;
  is_active: boolean;
  role: Database["public"]["Enums"]["user_role"];
}

export interface CourtAssignmentRow {
  id: string;
  court_id: string;
  assignment_type: string;
  started_at: string;
  ended_at: string | null;
  courts: { id: string; name: string; jurisdiction: string; is_active: boolean } | null;
}

export const courtAssignmentKeys = {
  search: (q: string) => ["admin", "profile-search", q] as const,
  profile: (id: string) => ["admin", "profile", id] as const,
  assignments: (profileId: string) => ["admin", "court-assignments", profileId] as const,
  waiting: ["admin", "unassigned-magistrates"] as const,
};

/**
 * Profile lookup for the Admin Court Assignments screen. This adds NO new
 * visibility — it relies entirely on the existing, unbroadened `profiles`
 * SELECT RLS policy ("Profiles are viewable by owner or admin"), under
 * which an Admin caller already lawfully sees every profile row. This is
 * a search/filter convenience on top of access an Admin already has, not
 * a new magistrate-visible directory. This screen (and therefore this
 * hook) is only ever rendered for an authenticated Admin — the route is
 * gated by `ProtectedRoute allowedRoles={["admin"]}` — so a non-admin
 * caller reaching it would simply see their own single profile row via
 * the same unmodified RLS, never a directory of others.
 */
export function useProfileSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: courtAssignmentKeys.search(trimmed),
    queryFn: async (): Promise<ProfileSearchResult[]> => {
      const escaped = trimmed.replace(/[%,]/g, "");
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, is_active, role")
        .or(`full_name.ilike.%${escaped}%,email.ilike.%${escaped}%`)
        .order("full_name")
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: trimmed.length >= 2,
  });
}

/**
 * Magistrates with no currently-active magistrate_courts row. Admin-only
 * route; uses the existing "Admins can view all profiles" SELECT policy,
 * not a new directory. Shown as a list so an administrator does not have
 * to search for people waiting on a first court assignment.
 */
export function useUnassignedMagistrates() {
  return useQuery({
    queryKey: courtAssignmentKeys.waiting,
    queryFn: async (): Promise<ProfileSearchResult[]> => {
      const [profilesResult, assignmentsResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, email, is_active, role")
          .eq("role", "magistrate")
          .order("full_name"),
        supabase
          .from("magistrate_courts")
          .select("profile_id")
          .is("ended_at", null),
      ]);
      if (profilesResult.error) throw profilesResult.error;
      if (assignmentsResult.error) throw assignmentsResult.error;
      const assigned = new Set((assignmentsResult.data ?? []).map((row) => row.profile_id));
      return (profilesResult.data ?? []).filter((profile) => !assigned.has(profile.id));
    },
  });
}

/** A single profile by id, once a search result has been selected. */
export function useProfile(profileId: string | undefined) {
  return useQuery({
    queryKey: courtAssignmentKeys.profile(profileId ?? ""),
    queryFn: async (): Promise<ProfileSearchResult | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, is_active, role")
        .eq("id", profileId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!profileId,
  });
}

/**
 * Every `magistrate_courts` row for one profile — current (`ended_at is
 * null`) AND historical alike. History is never deleted
 * (`protect_magistrate_court_history()`, 0017) so both are surfaced here,
 * never merged or hidden.
 */
export function useProfileCourtAssignments(profileId: string | undefined) {
  return useQuery({
    queryKey: courtAssignmentKeys.assignments(profileId ?? ""),
    queryFn: async (): Promise<CourtAssignmentRow[]> => {
      const { data, error } = await supabase
        .from("magistrate_courts")
        .select(
          "id, court_id, assignment_type, started_at, ended_at, courts(id, name, jurisdiction, is_active)",
        )
        .eq("profile_id", profileId as string)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!profileId,
  });
}

export type CourtAssignmentType = "regular" | "acting" | "relief" | "other";

export type CreateCourtAssignmentInput =
  | string
  | { courtId: string; assignmentType?: CourtAssignmentType };

function invalidateAfterAdminCourtChange(
  queryClient: ReturnType<typeof useQueryClient>,
  profileId: string,
) {
  void queryClient.invalidateQueries({ queryKey: courtAssignmentKeys.assignments(profileId) });
  void queryClient.invalidateQueries({ queryKey: courtAssignmentKeys.waiting });
  void queryClient.invalidateQueries({ queryKey: ["dashboard", "current-courts"] });
  void queryClient.invalidateQueries({ queryKey: ["docket", "my-current-courts"] });
  void queryClient.invalidateQueries({ queryKey: ["magistrate-court-requests", "my-assignments"] });
  void queryClient.invalidateQueries({ queryKey: ["magistrate-court-requests", "courts"] });
  void queryClient.invalidateQueries({ queryKey: ["admin", "people"] });
}

/**
 * Create a Court assignment via admin_assign_magistrate_court()
 * (0108/0110, SECURITY DEFINER) rather than a raw table insert — same
 * admin-only authority (is_admin(), re-verified inside the RPC), but with
 * clean conflict handling: a primary-exclusivity conflict (0105) or a
 * same-(profile,court) duplicate surfaces as a readable message instead of
 * a raw Postgres error. `check_court_active_for_assignment()` (0017,
 * unmodified) remains the backend gate against assigning an inactive
 * Court, including for Admins.
 *
 * A string argument (the Court Assignments roster) creates a `regular`
 * assignment. Pass `{ courtId, assignmentType }` when the caller needs
 * acting/relief/other — required for an administrator seating themselves,
 * because 0110 blocks a silent self-assign of `regular`.
 */
export function useCreateCourtAssignment(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCourtAssignmentInput) => {
      const courtId = typeof input === "string" ? input : input.courtId;
      const assignmentType = typeof input === "string" ? "regular" : (input.assignmentType ?? "regular");
      const { error } = await supabase.rpc("admin_assign_magistrate_court", {
        p_profile_id: profileId,
        p_court_id: courtId,
        p_assignment_type: assignmentType,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Court assignment created.");
      invalidateAfterAdminCourtChange(queryClient, profileId);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

/**
 * End a profile's current Court assignment via relinquish_magistrate_court()
 * (0108, SECURITY DEFINER) — the same function a magistrate uses to end
 * their own assignment, here exercised under its is_admin() branch. Only
 * sets `ended_at`/`ended_by`/`end_reason` — the row itself is never
 * deleted, preserving history.
 */
export function useEndCourtAssignment(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase.rpc("relinquish_magistrate_court", {
        p_assignment_id: assignmentId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Court assignment ended.");
      invalidateAfterAdminCourtChange(queryClient, profileId);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}
