import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";

const tagsKey = (caseLawId: string) => ["case-law-tags", caseLawId] as const;

/**
 * `case_law_tags` reads are open to any authenticated user (this is the
 * shared canonical `tags` taxonomy, not the free-text per-record tagging
 * used by Docket Matters/Judgments).
 */
export function useCaseLawTags(caseLawId: string | undefined) {
  return useQuery({
    queryKey: tagsKey(caseLawId ?? ""),
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

/**
 * Admin-only, via `apply_case_law_tags` (0060). Reconciles case_law_tags
 * to exactly the supplied tag NAME list -- an explicit reviewer decision,
 * never automatic (see §15 of the ingestion repair: proposed tags from
 * extraction are a SUGGESTION, not a classification, until a reviewer
 * accepts them here).
 */
export function useApplyCaseLawTags(caseLawId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tagNames: string[]) => {
      const { error } = await supabase.rpc("apply_case_law_tags", {
        p_case_law_id: caseLawId,
        p_tag_names: tagNames,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tags saved.");
      void queryClient.invalidateQueries({ queryKey: tagsKey(caseLawId) });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}
