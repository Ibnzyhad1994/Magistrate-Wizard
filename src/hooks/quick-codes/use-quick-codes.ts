import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

export const quickCodesKeys = {
  all: ["quick-codes"] as const,
};

/** Owner-only per RLS — this always returns exactly the caller's own Quick Codes, never another user's. */
export function useQuickCodes() {
  return useQuery({
    queryKey: quickCodesKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quick_codes")
        .select("*")
        .order("code_word", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

interface QuickCodeInput {
  code_word: string;
  title: string | null;
  content: string;
  description: string | null;
  category: string | null;
}

export function useCreateQuickCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: QuickCodeInput) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { data, error } = await supabase
        .from("quick_codes")
        .insert({ ...values, owner_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Quick Code created.");
      void queryClient.invalidateQueries({ queryKey: quickCodesKeys.all });
    },
  });
}

export function useUpdateQuickCode(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: QuickCodeInput) => {
      const { error } = await supabase.from("quick_codes").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Quick Code updated.");
      void queryClient.invalidateQueries({ queryKey: quickCodesKeys.all });
    },
  });
}

export function useDeleteQuickCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("quick_codes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Quick Code deleted.");
      void queryClient.invalidateQueries({ queryKey: quickCodesKeys.all });
    },
  });
}
