import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Linked Judgments / Case Law for a Docket Matter. These are plain joins
 * through the link tables with the parent entity embedded — RLS on
 * `judgments` (owner-or-discoverable) and `case_law` (canonical-or-owned)
 * applies transparently to the embedded rows, so a linked-but-inaccessible
 * Judgment/Case Law row simply will not come back from Postgres. No extra
 * frontend filtering is layered on top, and none should be — this is the
 * one place where the DB, not the UI, is the enforcement point.
 */
export function useLinkedJudgments(matterId: string | undefined) {
  return useQuery({
    queryKey: ["docket-linked-judgments", matterId ?? ""],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("docket_matter_judgments")
        .select(
          "id, created_at, judgment_id, judgments(id, title, case_number, citation, status, is_discoverable, owner_id)",
        )
        .eq("docket_matter_id", matterId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!matterId,
  });
}

export function useLinkedCaseLaw(matterId: string | undefined) {
  return useQuery({
    queryKey: ["docket-linked-case-law", matterId ?? ""],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("docket_matter_case_law")
        .select(
          "id, created_at, case_law_id, case_law(id, case_name, citation, court, jurisdiction, owner_id, is_discoverable)",
        )
        .eq("docket_matter_id", matterId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!matterId,
  });
}
