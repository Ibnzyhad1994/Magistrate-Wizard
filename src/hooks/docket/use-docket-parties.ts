import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { TablesInsert, TablesUpdate } from "@/types/database.types";

const key = (matterId: string) => ["docket-parties", matterId] as const;

/**
 * Docket Matter Parties. No hard delete — mistaken entries are corrected
 * via `party_status = 'entered_in_error'` (a live CHECK-constraint value),
 * not row deletion. `contact_info` is only ever rendered inside this
 * workspace (never in list views) to avoid exposing it outside lawful
 * access paths.
 */
export function useDocketParties(matterId: string | undefined) {
  return useQuery({
    queryKey: key(matterId ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("docket_matter_parties")
        .select("*")
        .eq("docket_matter_id", matterId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!matterId,
  });
}

export function useCreateDocketParty(matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      values: Omit<TablesInsert<"docket_matter_parties">, "docket_matter_id">,
    ) => {
      const { data, error } = await supabase
        .from("docket_matter_parties")
        .insert({ ...values, docket_matter_id: matterId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Party added.");
      void queryClient.invalidateQueries({ queryKey: key(matterId) });
    },
  });
}

export function useUpdateDocketParty(matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      values,
    }: {
      id: string;
      values: TablesUpdate<"docket_matter_parties">;
    }) => {
      const { data, error } = await supabase
        .from("docket_matter_parties")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Party updated.");
      void queryClient.invalidateQueries({ queryKey: key(matterId) });
    },
  });
}
