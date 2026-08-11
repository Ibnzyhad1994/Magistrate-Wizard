import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Module-scoped full-text search, shared by every list page that has its
 * own `search_X(p_query, p_limit)` RPC (see 0010/0047) — Docket Matters,
 * Judgments, Case Law, Quick Codes, Bench Notes, and Legislation. Each of
 * these RPCs is `SECURITY INVOKER` and searches ONLY its own table, so a
 * query typed into e.g. the Judgments list can never surface Case Law or
 * Docket results — that scoping is enforced by which RPC is called, not
 * by client-side filtering of a broader result set.
 *
 * This intentionally does NOT replace a list page's own `useX()` query —
 * it returns just the set of matching ids (ranked highest-first), which
 * the caller intersects with its already-fetched, already-categorized
 * rows (e.g. Draft/Final/Discoverable tabs) so existing categorization
 * and RLS-scoped field selection are preserved. This avoids growing each
 * search RPC to also return every column every list page happens to
 * display.
 */
export function useScopedSearchIds(
  rpcName:
    | "search_judgments"
    | "search_case_law"
    | "search_docket_matters"
    | "search_quick_codes"
    | "search_statutes"
    | "search_bench_notes",
  query: string,
) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["scoped-search", rpcName, trimmed],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(rpcName, { p_query: trimmed, p_limit: 100 });
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.id));
    },
    enabled: trimmed.length > 0,
  });
}
