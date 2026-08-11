import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

const key = (caseLawId: string) => ["case-law-annotations", caseLawId] as const;

/**
 * Private, owner-only annotations on a Case Law entry. RLS
 * (`owner_id = auth.uid() AND can_view_case_law(case_law_id)`) means this
 * query only ever returns the CALLER's own annotations — another user's
 * annotations on the same Case Law are invisible even though the Case Law
 * itself may be canonical or shared-via-discoverability.
 */
export function useCaseLawAnnotations(caseLawId: string | undefined) {
  return useQuery({
    queryKey: key(caseLawId ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_law_annotations")
        .select("*")
        .eq("case_law_id", caseLawId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!caseLawId,
  });
}

export function useCreateCaseLawAnnotation(caseLawId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (annotation_text: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { error } = await supabase.from("case_law_annotations").insert({
        case_law_id: caseLawId,
        owner_id: user.id,
        annotation_text,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Annotation added.");
      void queryClient.invalidateQueries({ queryKey: key(caseLawId) });
    },
  });
}

export function useUpdateCaseLawAnnotation(caseLawId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, annotation_text }: { id: string; annotation_text: string }) => {
      const { error } = await supabase
        .from("case_law_annotations")
        .update({ annotation_text })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Annotation updated.");
      void queryClient.invalidateQueries({ queryKey: key(caseLawId) });
    },
  });
}

export function useDeleteCaseLawAnnotation(caseLawId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("case_law_annotations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Annotation deleted.");
      void queryClient.invalidateQueries({ queryKey: key(caseLawId) });
    },
  });
}
