import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Read-only. `case_law_tags` assignment is Admin-only per backend RLS
 * (this is the shared canonical `tags` taxonomy, not the free-text
 * per-record tagging used by Docket Matters/Judgments) — the frontend
 * only ever displays these, never writes them.
 */
export function useCaseLawTags(caseLawId: string | undefined) {
  return useQuery({
    queryKey: ["case-law-tags", caseLawId ?? ""],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_law_tags")
        .select("case_law_id, tags(id, name, color)")
        .eq("case_law_id", caseLawId as string);
      if (error) throw error;
      return data;
    },
    enabled: !!caseLawId,
  });
}
