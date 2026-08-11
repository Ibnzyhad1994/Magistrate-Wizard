import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { TablesInsert, TablesUpdate } from "@/types/database.types";

export const docketMattersKeys = {
  all: ["docket-matters"] as const,
  list: (search: string) => ["docket-matters", "list", search] as const,
  detail: (id: string) => ["docket-matters", "detail", id] as const,
};

/**
 * Docket Matter list. RLS (three-path predicate: current Court assignment
 * OR retained assignment OR active Docket share) filters this transparently
 * — no client-side access filtering is layered on top. `search` uses the
 * full-text `search_docket_matters` RPC when non-empty, otherwise a plain
 * ordered select.
 */
export function useDocketMatters(search: string) {
  return useQuery({
    queryKey: docketMattersKeys.list(search.trim()),
    queryFn: async () => {
      const trimmed = search.trim();
      if (trimmed) {
        const { data, error } = await supabase.rpc("search_docket_matters", {
          p_query: trimmed,
          p_limit: 50,
        });
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from("docket_matters")
        .select(
          "id, case_number, matter_title, status, charge_or_issue, created_at, updated_at, court_id, district_id",
        )
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
}

export function useDocketMatter(id: string | undefined) {
  return useQuery({
    queryKey: docketMattersKeys.detail(id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("docket_matters")
        .select(
          "*, courts(id, name, jurisdiction), magisterial_districts(id, name)",
        )
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateDocketMatter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: TablesInsert<"docket_matters">) => {
      const { data, error } = await supabase
        .from("docket_matters")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Docket matter created.");
      void queryClient.invalidateQueries({ queryKey: docketMattersKeys.all });
    },
  });
}

export function useUpdateDocketMatter(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: TablesUpdate<"docket_matters">) => {
      const { data, error } = await supabase
        .from("docket_matters")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Docket matter updated.");
      void queryClient.invalidateQueries({
        queryKey: docketMattersKeys.detail(id),
      });
      void queryClient.invalidateQueries({ queryKey: docketMattersKeys.all });
    },
  });
}
