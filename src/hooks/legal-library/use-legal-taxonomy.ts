import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Read-only frontend surface for the normalized Court/Jurisdiction
 * reference catalogue (0058): `legal_regional_groups` / `legal_jurisdictions`
 * / `legal_authority_courts`. Shared reference data — readable by every
 * authenticated user, write-restricted to admins at the RLS layer (no
 * admin-only write UI is built in this pass; the seeded catalogue is
 * extended by direct data entry later, per the explicit "do not hard-code
 * the entire Court list inside one React component" instruction — these
 * hooks read the data-driven table, they don't define it).
 *
 * Deliberately distinct from `legal_sources` (use-legal-sources.ts, the
 * SOURCE REPOSITORY a document came from) and from the unrelated `courts`
 * table (physical Guyana Magistrates' Courts used for Docket authority) —
 * three different concepts that must never be conflated in the UI.
 */
export const legalTaxonomyKeys = {
  regionalGroups: ["legal-taxonomy", "regional-groups"] as const,
  jurisdictions: ["legal-taxonomy", "jurisdictions"] as const,
  courts: ["legal-taxonomy", "courts"] as const,
};

export function useLegalRegionalGroups() {
  return useQuery({
    queryKey: legalTaxonomyKeys.regionalGroups,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legal_regional_groups")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useLegalJurisdictions() {
  return useQuery({
    queryKey: legalTaxonomyKeys.jurisdictions,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legal_jurisdictions")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** All active canonical courts, alphabetically — small enough (dozens, not thousands) to filter client-side by jurisdiction/regional group. */
export function useLegalAuthorityCourts() {
  return useQuery({
    queryKey: legalTaxonomyKeys.courts,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legal_authority_courts")
        .select("*")
        .eq("is_active", true)
        .order("canonical_name", { ascending: true });
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** RLS-respecting published-result counts per court/jurisdiction, for Browse UI badges (0058 `case_law_counts_by_court`/`case_law_counts_by_jurisdiction`). */
export function useCaseLawCountsByCourt() {
  return useQuery({
    queryKey: ["legal-taxonomy", "case-law-counts-by-court"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("case_law_counts_by_court");
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.court_id, r.result_count]));
    },
    staleTime: 60 * 1000,
  });
}

export function useCaseLawCountsByJurisdiction() {
  return useQuery({
    queryKey: ["legal-taxonomy", "case-law-counts-by-jurisdiction"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("case_law_counts_by_jurisdiction");
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.jurisdiction_id, r.result_count]));
    },
    staleTime: 60 * 1000,
  });
}
