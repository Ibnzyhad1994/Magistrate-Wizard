import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

export const caseLawKeys = {
  all: ["case-law"] as const,
  detail: (id: string) => ["case-law", "detail", id] as const,
};

/**
 * Every Case Law row the caller can currently see — canonical (owner_id
 * IS NULL), their own personal research, and other magistrates' research
 * marked discoverable. RLS enforces this transparently; split into
 * Canonical / My Research / Discoverable tabs client-side, same pattern
 * as `useJudgments`.
 */
export function useCaseLawList() {
  return useQuery({
    queryKey: caseLawKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_law")
        .select(
          "id, case_name, citation, court, jurisdiction, decided_date, is_discoverable, owner_id, updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data;
    },
  });
}

export function useCaseLawItem(id: string | undefined) {
  return useQuery({
    queryKey: caseLawKeys.detail(id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_law")
        .select("*")
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

interface CaseLawInput {
  case_name: string;
  citation: string;
  court: string;
  jurisdiction: string;
  decided_date: string | null;
  source_url: string | null;
  summary: string | null;
  full_text: string | null;
}

/** Always creates PERSONAL research (owner_id = caller) — see validations/case-law.ts. */
export function useCreatePersonalCaseLaw() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: CaseLawInput) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { data, error } = await supabase
        .from("case_law")
        .insert({ ...values, owner_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Research entry created.");
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.all });
    },
  });
}

export function useUpdateCaseLawFields(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<CaseLawInput>) => {
      const { data, error } = await supabase
        .from("case_law")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Saved.");
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.all });
    },
  });
}

export function useSetCaseLawDiscoverable(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (is_discoverable: boolean) => {
      const { error } = await supabase
        .from("case_law")
        .update({ is_discoverable })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Discoverability updated.");
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.all });
    },
  });
}

/** Owner-only per RLS (canonical rows have no Delete control in this frontend — admin-only, out of scope here). */
export function useDeleteCaseLaw() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("case_law").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Research entry deleted.");
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.all });
    },
  });
}
