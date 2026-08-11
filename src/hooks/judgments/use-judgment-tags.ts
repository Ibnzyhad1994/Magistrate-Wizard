import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";

const key = (judgmentId: string) => ["judgment-tags", judgmentId] as const;

export function useJudgmentTags(judgmentId: string | undefined) {
  return useQuery({
    queryKey: key(judgmentId ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("judgment_tags")
        .select("*")
        .eq("judgment_id", judgmentId as string)
        .order("tag_name", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!judgmentId,
  });
}

export function useAddJudgmentTag(judgmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tag_name: string) => {
      const { error } = await supabase
        .from("judgment_tags")
        .insert({ judgment_id: judgmentId, tag_name });
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key(judgmentId) }),
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useRemoveJudgmentTag(judgmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("judgment_tags").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key(judgmentId) }),
  });
}
