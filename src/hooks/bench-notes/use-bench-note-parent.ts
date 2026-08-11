import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { BenchNoteParentType } from "@/lib/validations/bench-note";

export interface ResolvedParent {
  label: string;
  subtitle: string | null;
}

/**
 * Resolves a Bench Note's polymorphic parent (`entity_type`/`entity_id`,
 * no FK) to a display label — single lookup, only fired on the detail
 * page (never eagerly per list row, to avoid N+1). If the parent row is
 * gone or the caller has since lost access, this simply returns `null`
 * (RLS denial and "doesn't exist" are indistinguishable and handled the
 * same way) and the UI shows "Parent unavailable" rather than breaking.
 */
export function useBenchNoteParent(
  entityType: BenchNoteParentType | string | undefined,
  entityId: string | undefined,
) {
  return useQuery({
    queryKey: ["bench-note-parent", entityType ?? "", entityId ?? ""],
    queryFn: async (): Promise<ResolvedParent | null> => {
      if (entityType === "docket_matter") {
        const { data, error } = await supabase
          .from("docket_matters")
          .select("matter_title, case_number")
          .eq("id", entityId as string)
          .maybeSingle();
        if (error) throw error;
        return data ? { label: data.matter_title, subtitle: data.case_number } : null;
      }
      if (entityType === "judgment") {
        const { data, error } = await supabase
          .from("judgments")
          .select("title, case_number")
          .eq("id", entityId as string)
          .maybeSingle();
        if (error) throw error;
        return data ? { label: data.title, subtitle: data.case_number } : null;
      }
      if (entityType === "case_law") {
        const { data, error } = await supabase
          .from("case_law")
          .select("case_name, citation")
          .eq("id", entityId as string)
          .maybeSingle();
        if (error) throw error;
        return data ? { label: data.case_name, subtitle: data.citation } : null;
      }
      return null;
    },
    enabled: !!entityType && !!entityId,
    meta: { silent: true },
  });
}
