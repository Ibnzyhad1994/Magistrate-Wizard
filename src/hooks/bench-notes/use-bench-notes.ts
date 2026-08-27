import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { Json } from "@/types/database.types";
import type { BenchNoteParentType } from "@/lib/validations/bench-note";

export const benchNotesKeys = {
  all: ["bench-notes"] as const,
  detail: (id: string) => ["bench-notes", "detail", id] as const,
};

/** Author-only per RLS — always exactly the caller's own notes, regardless of `is_private`. */
/** `enabled` defaults to true -- pass `{ enabled: false }` to skip fetching (e.g. dashboard-page.tsx never queries Bench Notes for a clerk). */
export function useBenchNotes(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: benchNotesKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bench_notes")
        .select("id, title, entity_type, entity_id, status, is_private, updated_at")
        .order("updated_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data;
    },
    enabled: options?.enabled,
  });
}

export function useBenchNote(id: string | undefined) {
  return useQuery({
    queryKey: benchNotesKeys.detail(id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bench_notes")
        .select("*")
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateBenchNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      title: string;
      entity_type: BenchNoteParentType;
      entity_id: string;
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { data, error } = await supabase
        .from("bench_notes")
        .insert({ ...values, author_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Bench Note created.");
      void queryClient.invalidateQueries({ queryKey: benchNotesKeys.all });
    },
  });
}

export function useUpdateBenchNoteFields(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      title?: string;
      is_private?: boolean;
      status?: "draft" | "published";
    }) => {
      const { error } = await supabase.from("bench_notes").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saved.");
      void queryClient.invalidateQueries({ queryKey: benchNotesKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: benchNotesKeys.all });
    },
  });
}

export function useUpdateBenchNoteContent(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ content, content_text }: { content: Json; content_text: string }) => {
      const { error } = await supabase
        .from("bench_notes")
        .update({ content, content_text })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: benchNotesKeys.detail(id) });
    },
  });
}

export function useDeleteBenchNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bench_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bench Note deleted.");
      void queryClient.invalidateQueries({ queryKey: benchNotesKeys.all });
    },
  });
}
