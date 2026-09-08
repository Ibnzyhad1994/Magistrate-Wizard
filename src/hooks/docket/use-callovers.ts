import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/utils";
import type { TablesInsert, TablesUpdate } from "@/types/database.types";

export const calloverKeys = {
  all: ["callovers"] as const,
  list: (courtId: string | null) => ["callovers", "list", courtId] as const,
  detail: (id: string | undefined) => ["callovers", "detail", id] as const,
  items: (calloverId: string | undefined) => ["callovers", "items", calloverId] as const,
};

/**
 * Callover sittings the caller can see. RLS (can_access_court on the
 * callover's own court, or is_admin) does the filtering — there is no
 * client-side access check layered on top. `courtId` narrows to one
 * court; null spans every court the caller currently sits.
 */
export function useCallovers(courtId: string | null) {
  return useQuery({
    queryKey: calloverKeys.list(courtId),
    queryFn: async () => {
      let query = supabase
        .from("docket_callovers")
        .select("*, courts(name), docket_callover_items(id, called_at)")
        .order("callover_date", { ascending: false });
      if (courtId) query = query.eq("court_id", courtId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export function useCallover(id: string | undefined) {
  return useQuery({
    queryKey: calloverKeys.detail(id),
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("docket_callovers")
        .select("*, courts(id, name, district_id)")
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * The running sheet's rows, each with the matter identity and current
 * board position it needs. `docket_matters` is embedded through the
 * single FK on this table, so the relationship is unambiguous.
 */
export function useCalloverItems(calloverId: string | undefined) {
  return useQuery({
    queryKey: calloverKeys.items(calloverId),
    enabled: Boolean(calloverId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("docket_callover_items")
        .select(
          `*, docket_matters(
            id, case_number, matter_title, charge_or_issue, status, procedure_stage,
            category_id, brought_forward_from
          )`,
        )
        .eq("callover_id", calloverId as string)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

function invalidateCallover(queryClient: ReturnType<typeof useQueryClient>, calloverId?: string) {
  void queryClient.invalidateQueries({ queryKey: calloverKeys.all });
  if (calloverId) {
    void queryClient.invalidateQueries({ queryKey: calloverKeys.items(calloverId) });
  }
}

export function useCreateCallover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: TablesInsert<"docket_callovers">) => {
      const { data, error } = await supabase
        .from("docket_callovers")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Callover created.");
      invalidateCallover(queryClient);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}

export function useUpdateCallover(id: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: TablesUpdate<"docket_callovers">) => {
      const { data, error } = await supabase
        .from("docket_callovers")
        .update(values)
        .eq("id", id as string)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateCallover(queryClient, id),
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}

export function useDeleteCallover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("docket_callovers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Draft callover deleted.");
      invalidateCallover(queryClient);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}

/**
 * Fills the sheet from the day's own list in one round trip. The RPC is
 * SECURITY INVOKER and idempotent — re-running only adds what is missing,
 * so it is safe to press twice.
 */
export function usePopulateCallover(calloverId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (date: string | null) => {
      const { data, error } = await supabase.rpc("populate_callover_from_date", {
        p_callover_id: calloverId as string,
        p_date: date ?? undefined,
      });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: (added) => {
      toast.success(
        added === 0
          ? "No further matters listed for that date."
          : `${added} matter${added === 1 ? "" : "s"} added to the callover.`,
      );
      invalidateCallover(queryClient, calloverId);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}

export function useAddCalloverItem(calloverId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ matterId, sortOrder }: { matterId: string; sortOrder: number }) => {
      const { data, error } = await supabase
        .from("docket_callover_items")
        .insert({
          callover_id: calloverId as string,
          docket_matter_id: matterId,
          sort_order: sortOrder,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateCallover(queryClient, calloverId),
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}

/**
 * Quiet by design — the running sheet saves row-by-row as the magistrate
 * works, and a toast per keystroke-settled field would be noise. Errors
 * still surface through the mutation cache subscriber.
 */
export function useUpdateCalloverItem(calloverId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: TablesUpdate<"docket_callover_items"> }) => {
      const { data, error } = await supabase
        .from("docket_callover_items")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => invalidateCallover(queryClient, calloverId),
  });
}

export function useRemoveCalloverItem(calloverId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("docket_callover_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removed from the callover.");
      invalidateCallover(queryClient, calloverId);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}
