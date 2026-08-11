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
