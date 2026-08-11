import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Docket Matters this Judgment is linked to (read-only here — linking
 * happens from the Docket workspace, matching how the Docket side of
 * this same association is also read-only). RLS on the embedded
 * `docket_matters` row governs visibility transparently.
 */
export function useJudgmentDocketMatters(judgmentId: string | undefined) {
  return useQuery({
    queryKey: ["judgment-docket-matters", judgmentId ?? ""],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("docket_matter_judgments")
        .select(
          "id, created_at, docket_matter_id, docket_matters(id, case_number, matter_title, status)",
        )
        .eq("judgment_id", judgmentId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!judgmentId,
  });
}

/** This owner's own Quick Code associations for this Judgment (quick_codes RLS is owner-only, so this is inherently private to the owner). */
export function useJudgmentQuickCodes(judgmentId: string | undefined) {
  return useQuery({
    queryKey: ["judgment-quick-codes", judgmentId ?? ""],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quick_code_judgments")
        .select("id, created_at, quick_code_id, quick_codes(id, code_word, title)")
        .eq("judgment_id", judgmentId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!judgmentId,
  });
}
