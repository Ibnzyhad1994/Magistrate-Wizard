import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Frontend surface for the EXISTING `statutes` table (0005) — a flat,
 * institutional/canonical legal-instrument table, admin-write-only per
 * its own RLS (0005/0012: SELECT open to all authenticated users, INSERT
 * /UPDATE/DELETE admin-only). This is the first-class "Legislation"
 * workspace's READ side (Part K, PHASE 3 scope as actually completed
 * this pass) — it does not add any new table/column. `statutes` was
 * previously reachable only via Global Search results with no working
 * link (see search-page.tsx's prior comment); this restores a real
 * list + detail route + bookmark support for data that already existed.
 *
 * NOT implemented here (see architecture spec / final report for the
 * deferred remainder): Act/Part/Chapter/Section/Subsection hierarchy,
 * amendment/version tracking, a dedicated ingestion pipeline, or a
 * curator/review UI — `statutes` remains a flat single-level table, and
 * populating/editing it is still an admin/database-level operation only,
 * exactly as it was before this pass.
 */
export const legislationKeys = {
  all: ["legislation"] as const,
  detail: (id: string) => ["legislation", "detail", id] as const,
};

export function useStatutes() {
  return useQuery({
    queryKey: legislationKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("statutes")
        .select("id, code, title, jurisdiction, effective_date, updated_at")
        .order("title", { ascending: true })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });
}

export function useStatute(id: string | undefined) {
  return useQuery({
    queryKey: legislationKeys.detail(id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("statutes")
        .select("*")
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}
