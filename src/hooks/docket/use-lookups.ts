import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Reference-data lookups shared across the Docket workspace (Court /
 * District pickers, current-Court context). These are small, slow-moving
 * tables, so a longer staleTime is fine.
 */

export function useCourts() {
  return useQuery({
    queryKey: ["courts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courts")
        .select("id, name, jurisdiction, is_active")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useMagisterialDistricts() {
  return useQuery({
    queryKey: ["magisterial-districts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("magisterial_districts")
        .select("id, name, is_active")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export interface MyCurrentCourt {
  court_id: string;
  court_name: string;
  jurisdiction: string;
  district_id: string | null;
  district_name: string | null;
}

/**
 * The signed-in magistrate's CURRENT Court assignments
 * (`magistrate_courts` rows with `ended_at is null`), joined to the
 * corresponding `courts` row and its Magisterial District. This — NOT
 * `useCourts()` above — is the only lawful source for the Docket "New
 * matter" Court selector: ended assignments, Courts the caller isn't
 * assigned to, and inactive Courts must never appear as choices there.
 * (`useCourts()` remains correct for its one legitimate use, the Admin
 * Court Assignment screen, which needs the full active-Court reference
 * list.) `magistrate_courts` SELECT RLS (self-or-admin, unchanged by
 * `0052_harden_magistrate_court_assignment_authority.sql`) is what
 * actually scopes this to the caller's own rows; this hook adds only
 * the join/shape convenience on top, and additionally drops any row
 * whose Court has since gone inactive.
 */
export function useMyCurrentCourts() {
  return useQuery({
    queryKey: ["docket", "my-current-courts"],
    queryFn: async (): Promise<MyCurrentCourt[]> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("magistrate_courts")
        .select(
          "court_id, courts(id, name, jurisdiction, is_active, district_id, magisterial_districts(id, name))",
        )
        .eq("profile_id", user.id)
        .is("ended_at", null)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return (data ?? [])
        .filter((row) => row.courts?.is_active)
        .map((row) => ({
          court_id: row.court_id,
          court_name: row.courts?.name ?? "Unknown court",
          jurisdiction: row.courts?.jurisdiction ?? "",
          district_id: row.courts?.district_id ?? null,
          district_name: row.courts?.magisterial_districts?.name ?? null,
        }));
    },
    staleTime: 30_000,
  });
}

/**
 * The signed-in magistrate's current Court assignment, via the
 * `my_court_id()` RLS helper RPC rather than a broad `profiles`/
 * `magistrate_courts` SELECT.
 */
export function useMyCourtId() {
  return useQuery({
    queryKey: ["my-court-id"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_court_id");
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });
}
