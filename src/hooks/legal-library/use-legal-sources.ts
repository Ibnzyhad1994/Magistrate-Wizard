import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { TablesInsert, TablesUpdate } from "@/types/database.types";

/**
 * Admin-only CRUD over `legal_sources` (0055) — the source-adapter
 * registry described in the ingestion spec. Every row here is a
 * PROPOSED/reviewable source, not an active crawler: `connector_type`
 * is metadata only in this pass (no connector actually runs
 * automatically yet — see PHASE F deferral in the final report). This
 * hook layer exists so a curator can record "we intend to use this
 * source" with its jurisdiction/status/notes, which `import_jobs` rows
 * can then optionally reference via `source_id` for provenance.
 */
export const legalSourceKeys = {
  all: ["legal-sources"] as const,
  detail: (id: string) => ["legal-sources", "detail", id] as const,
};

export function useLegalSources() {
  return useQuery({
    queryKey: legalSourceKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legal_sources")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreateLegalSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: TablesInsert<"legal_sources">) => {
      const { data, error } = await supabase
        .from("legal_sources")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Source recorded.");
      void queryClient.invalidateQueries({ queryKey: legalSourceKeys.all });
    },
  });
}

export function useUpdateLegalSource(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: TablesUpdate<"legal_sources">) => {
      const { data, error } = await supabase
        .from("legal_sources")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Source updated.");
      void queryClient.invalidateQueries({ queryKey: legalSourceKeys.all });
    },
  });
}

export function useDeleteLegalSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("legal_sources").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Source removed.");
      void queryClient.invalidateQueries({ queryKey: legalSourceKeys.all });
    },
  });
}
