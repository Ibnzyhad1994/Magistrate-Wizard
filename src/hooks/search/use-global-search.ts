import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Single entry point for the Search page — `global_search()` is a plain
 * SECURITY INVOKER SQL function, so ordinary RLS on each underlying table
 * (cases/bench_notes/statutes/case_law/docket_matters/judgments/
 * quick_codes) applies exactly as it would to a direct query. We never
 * independently query any of those tables to "supplement" results —
 * whatever this RPC returns is, by construction, exactly what the caller
 * is allowed to see.
 */
export function useGlobalSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["global-search", trimmed],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("global_search", {
        p_query: trimmed,
        p_limit: 40,
      });
      if (error) throw error;
      return data;
    },
    enabled: trimmed.length > 0,
    meta: { silent: true },
  });
}
