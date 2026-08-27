import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";

/**
 * Reference-data lookups shared across the Docket workspace (Court /
 * District pickers, current-Court context). These are small, slow-moving
 * tables, so a longer staleTime is fine.
 */

/**
 * Anon-safe: for the PUBLIC registration page, rendered before the
 * visitor has any session at all. Calls the two narrow SECURITY DEFINER
 * RPCs (0095) instead of the real `magisterial_districts`/`courts`
 * tables, whose own SELECT RLS is deliberately authenticated-only and is
 * NOT weakened for this — see 0095's migration header. Never use these
 * for an already-authenticated context; use useMagisterialDistricts()/
 * useCourts() there instead.
 */
export function useSignupMagisterialDistricts() {
  return useQuery({
    queryKey: ["signup", "magisterial-districts"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_active_magisterial_districts_for_signup");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useSignupCourts() {
  return useQuery({
    queryKey: ["signup", "courts"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_active_courts_for_signup");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useCourts() {
  return useQuery({
    queryKey: ["courts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courts")
        .select("id, name, jurisdiction, is_active, district_id")
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
 * The signed-in user's CURRENT Court assignments -- `magistrate_courts`
 * for a magistrate, `clerk_courts` for an approved clerk (0087) -- joined
 * to the corresponding `courts` row and its Magisterial District. This —
 * NOT `useCourts()` above — is the only lawful source for the Docket
 * "New matter" Court selector: ended assignments, Courts the caller isn't
 * assigned to, and inactive Courts must never appear as choices there.
 * (`useCourts()` remains correct for its one legitimate use, the Admin
 * Court Assignment screen, which needs the full active-Court reference
 * list.) The underlying table's own SELECT RLS (self-or-admin for
 * magistrate_courts, self-or-manager-or-admin for clerk_courts) is what
 * actually scopes this to the caller's own rows; this hook adds only the
 * role dispatch, join, and shape convenience on top, and additionally
 * drops any row whose Court has since gone inactive. A clerk with zero
 * approved courts correctly gets an empty array here, not an error --
 * the pending-approval experience is handled by the dashboard/clerk
 * access pages, not by this hook.
 */
export function useMyCurrentCourts() {
  const { profile } = useAuth();
  const table = profile?.role === "clerk" ? "clerk_courts" : "magistrate_courts";
  return useQuery({
    queryKey: ["docket", "my-current-courts", profile?.id, table],
    queryFn: async (): Promise<MyCurrentCourt[]> => {
      if (!profile) return [];
      const { data, error } = await supabase
        .from(table)
        .select(
          "court_id, courts(id, name, jurisdiction, is_active, district_id, magisterial_districts(id, name))",
        )
        .eq("profile_id", profile.id)
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
    enabled: !!profile,
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
