import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Read-only associations for a Quick Code, fetched on demand (`enabled`)
 * rather than eagerly for every row in the list — avoids an N+1 query
 * fan-out across the whole Quick Codes list.
 */
export function useQuickCodeDocketMatters(quickCodeId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["quick-code-docket-matters", quickCodeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quick_code_docket_matters")
        .select("id, docket_matter_id, docket_matters(id, case_number, matter_title)")
        .eq("quick_code_id", quickCodeId);
      if (error) throw error;
      return data;
    },
    enabled,
  });
}

export function useQuickCodeJudgments(quickCodeId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["quick-code-judgments", quickCodeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quick_code_judgments")
        .select("id, judgment_id, judgments(id, title, case_number)")
        .eq("quick_code_id", quickCodeId);
      if (error) throw error;
      return data;
    },
    enabled,
  });
}

export function useQuickCodeCaseLaw(quickCodeId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["quick-code-case-law", quickCodeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quick_code_case_law")
        .select("id, case_law_id, case_law(id, case_name, citation)")
        .eq("quick_code_id", quickCodeId);
      if (error) throw error;
      return data;
    },
    enabled,
  });
}
