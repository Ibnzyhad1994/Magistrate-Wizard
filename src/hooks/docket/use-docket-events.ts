import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { TablesInsert, TablesUpdate } from "@/types/database.types";

const key = (matterId: string) => ["docket-events", matterId] as const;

/**
 * Docket Events are append-mostly: there is no hard-delete UI action.
 * Mistaken/incorrect events are corrected by editing the record or by
 * setting `event_status` to 'cancelled' / 'entered_in_error' (both live
 * CHECK-constraint values), preserving chronology per the established
 * Docket workflow rules.
 */
export function useDocketEvents(matterId: string | undefined) {
  return useQuery({
    queryKey: key(matterId ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("docket_events")
        .select("*")
        .eq("docket_matter_id", matterId as string)
        .order("scheduled_date", { ascending: false })
        .order("scheduled_time", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data;
    },
    enabled: !!matterId,
  });
}

export function useCreateDocketEvent(matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      values: Omit<TablesInsert<"docket_events">, "docket_matter_id">,
    ) => {
      const { data, error } = await supabase
        .from("docket_events")
        .insert({ ...values, docket_matter_id: matterId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Event added.");
      void queryClient.invalidateQueries({ queryKey: key(matterId) });
    },
  });
}

export function useUpdateDocketEvent(matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      values,
    }: {
      id: string;
      values: TablesUpdate<"docket_events">;
    }) => {
      const { data, error } = await supabase
        .from("docket_events")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Event updated.");
      void queryClient.invalidateQueries({ queryKey: key(matterId) });
    },
  });
}
