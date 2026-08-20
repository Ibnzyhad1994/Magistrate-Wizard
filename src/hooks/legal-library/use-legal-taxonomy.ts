import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { TablesInsert } from "@/types/database.types";

/**
 * Frontend surface for the normalized Court/Jurisdiction reference
 * catalogue (0058): `legal_regional_groups` / `legal_jurisdictions` /
 * `legal_authority_courts`. Shared reference data — readable by every
 * authenticated user, write-restricted to admins at the RLS layer.
 *
 * The read hooks were originally the only thing here ("no admin-only
 * write UI is built in this pass; the seeded catalogue is extended by
 * direct data entry later" — that "later" is `useCreateLegalJurisdiction`/
 * `useCreateLegalAuthorityCourt` below, added so a curator can add a
 * missing Court/Jurisdiction inline while cataloguing Case Law/Legislation
 * instead of needing direct DB access). Deliberately still going through
 * this catalogue rather than a free-text override on the case_law/statutes
 * row itself — a raw free-text field would let the same Court get entered
 * under several different spellings across records; going through this
 * table keeps one canonical row no matter how many records reference it.
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
  categories: ["legal-taxonomy", "categories"] as const,
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

/** Admin-only (enforced by RLS — `useMutation` here does not itself check role, the INSERT policy does). Used by the inline "+ Add new Jurisdiction" flow so a curator never has to leave the Case Law/Legislation form to catalogue a missing one. */
export function useCreateLegalJurisdiction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; regional_group_id: string }) => {
      const payload: TablesInsert<"legal_jurisdictions"> = {
        name: input.name.trim(),
        regional_group_id: input.regional_group_id,
      };
      const { data, error } = await supabase.from("legal_jurisdictions").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: legalTaxonomyKeys.jurisdictions });
    },
  });
}

/** Admin-only (RLS-enforced). `jurisdiction_id` is optional — a regional/supranational court (CCJ, JCPC) legitimately has none, exactly like the seeded catalogue. */
export function useCreateLegalAuthorityCourt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      canonical_name: string;
      short_name?: string | null;
      jurisdiction_id?: string | null;
      court_level?: string | null;
    }) => {
      const payload: TablesInsert<"legal_authority_courts"> = {
        canonical_name: input.canonical_name.trim(),
        short_name: input.short_name?.trim() || null,
        jurisdiction_id: input.jurisdiction_id || null,
        court_level: input.court_level || null,
      };
      const { data, error } = await supabase.from("legal_authority_courts").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: legalTaxonomyKeys.courts });
    },
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

/**
 * `legal_case_categories` (0073) -- the TYPE OF MATTER a Case Law record
 * relates to (e.g. "Murder", "Narcotics"), used for Browse/filter
 * navigation. Same shared-reference-data shape as Jurisdiction/Court above:
 * readable by every authenticated user, write-restricted to admins.
 * Deliberately distinct from `tags` -- see the 0073 migration header.
 */
export function useLegalCaseCategories() {
  return useQuery({
    queryKey: legalTaxonomyKeys.categories,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legal_case_categories")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Admin-only (RLS-enforced). Used by the inline "+ Add new Category…" flow so a curator never has to leave the Case Law form to catalogue a missing one. */
export function useCreateLegalCaseCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string }) => {
      const payload: TablesInsert<"legal_case_categories"> = { name: input.name.trim() };
      const { data, error } = await supabase.from("legal_case_categories").insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: legalTaxonomyKeys.categories });
    },
  });
}

/** RLS-respecting published-result counts per category, for Browse UI badges (0073 `case_law_counts_by_category`). */
export function useCaseLawCountsByCategory() {
  return useQuery({
    queryKey: ["legal-taxonomy", "case-law-counts-by-category"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("case_law_counts_by_category");
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.category_id, r.result_count]));
    },
    staleTime: 60 * 1000,
  });
}
