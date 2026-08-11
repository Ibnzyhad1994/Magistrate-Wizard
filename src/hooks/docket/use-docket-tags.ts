import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";

const key = (matterId: string) => ["docket-tags", matterId] as const;

/**
 * Docket Matter Tags — a simple free-text tag list scoped to one matter
 * (distinct from the legacy global `tags` table used by Case/Case Law/
 * Bench Notes/Statutes; do not conflate the two). Case-insensitive
 * de-duplication is enforced by the database, not the frontend — a
 * duplicate insert surfaces as a constraint-violation error here.
 */
export function useDocketTags(matterId: string | undefined) {
  return useQuery({
    queryKey: key(matterId ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("docket_matter_tags")
        .select("*")
        .eq("docket_matter_id", matterId as string)
        .order("tag_name", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!matterId,
  });
}

export function useAddDocketTag(matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tag_name: string) => {
      const { data, error } = await supabase
        .from("docket_matter_tags")
        .insert({ docket_matter_id: matterId, tag_name })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key(matterId) });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

export function useRemoveDocketTag(matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("docket_matter_tags")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key(matterId) });
    },
  });
}
