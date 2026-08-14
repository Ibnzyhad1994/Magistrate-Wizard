import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
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

/**
 * Create a Court assignment for another profile. The actual authority is
 * the `magistrate_courts` INSERT RLS policy ("Admins can create Court
 * assignments", `with check (is_admin())` — 0052); this mutation merely
 * exercises it as an Admin. `check_court_active_for_assignment()` (0017,
 * unmodified) remains the backend gate against assigning an inactive
 * Court, including for Admins.
 */
export function useCreateCourtAssignment(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (courtId: string) => {
      const { error } = await supabase.from("magistrate_courts").insert({
        profile_id: profileId,
        court_id: courtId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Court assignment created.");
      void queryClient.invalidateQueries({ queryKey: courtAssignmentKeys.assignments(profileId) });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "current-courts"] });
    },
  });
}

/**
 * End a profile's current Court assignment. The actual authority is the
 * `magistrate_courts` UPDATE RLS policy ("Admins can manage Court
 * assignments", `using/with check (is_admin())` — 0052). Only sets
 * `ended_at` — the row itself is never deleted, preserving history.
 */
export function useEndCourtAssignment(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase
        .from("magistrate_courts")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", assignmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Court assignment ended.");
      void queryClient.invalidateQueries({ queryKey: courtAssignmentKeys.assignments(profileId) });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "current-courts"] });
    },
  });
}
