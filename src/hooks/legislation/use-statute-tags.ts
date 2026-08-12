import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";

const tagsKey = (statuteId: string) => ["statute-tags", statuteId] as const;

/** Mirrors use-case-law-tags.ts exactly (0006 `tags` shared taxonomy, `statute_tags` join). */
export function useStatuteTags(statuteId: string | undefined) {
  return useQuery({
    queryKey: tagsKey(statuteId ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("statute_tags")
        .select("statute_id, tags(id, name, color)")
        .eq("statute_id", statuteId as string);
      if (error) throw error;
      return data;
    },
    enabled: !!statuteId,
  });
}

/** Admin-only, via `apply_statute_tags` (0060). See use-case-law-tags.ts useApplyCaseLawTags for the full rationale. */
export function useApplyStatuteTags(statuteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tagNames: string[]) => {
      const { error } = await supabase.rpc("apply_statute_tags", {
        p_statute_id: statuteId,
        p_tag_names: tagNames,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tags saved.");
      void queryClient.invalidateQueries({ queryKey: tagsKey(statuteId) });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}
