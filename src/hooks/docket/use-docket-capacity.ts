import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";
import type { Database } from "@/types/database.types";

export const docketCapacityKeys = {
  categories: ["docket-matter-categories"] as const,
  settings: ["docket-capacity-settings"] as const,
  snapshot: (date: string) => ["docket-capacity-snapshot", date] as const,
};

export type CapacitySnapshotRow =
  Database["public"]["Functions"]["get_docket_capacity_snapshot"]["Returns"][number];

export type ScheduleWithCapacityResult =
  Database["public"]["Functions"]["schedule_docket_event_with_capacity"]["Returns"][number];

export type SetNextDateResult =
  Database["public"]["Functions"]["set_docket_matter_next_date"]["Returns"][number];

export function useDocketMatterCategories() {
  return useQuery({
    queryKey: docketCapacityKeys.categories,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("docket_matter_categories")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });
}

/** The calling magistrate's own capacity settings, one row per configured category. */
export function useDocketCapacitySettings() {
  return useQuery({
    queryKey: docketCapacityKeys.settings,
    queryFn: async () => {
      const { data, error } = await supabase.from("docket_capacity_settings").select("*");
      if (error) throw error;
      return data;
    },
  });
}

export function useUpsertDocketCapacitySetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      categoryId,
      dailyCapacity,
    }: {
      categoryId: string;
      dailyCapacity: number;
    }) => {
      const { error } = await supabase
        .from("docket_capacity_settings")
        .upsert(
          { category_id: categoryId, daily_capacity: dailyCapacity },
          { onConflict: "owner_id,category_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Capacity saved.");
      void queryClient.invalidateQueries({ queryKey: docketCapacityKeys.settings });
      void queryClient.invalidateQueries({ queryKey: ["docket-capacity-snapshot"] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}

export function useDeleteDocketCapacitySetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("docket_capacity_settings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Capacity limit removed — this category is unrestricted again.");
      void queryClient.invalidateQueries({ queryKey: docketCapacityKeys.settings });
      void queryClient.invalidateQueries({ queryKey: ["docket-capacity-snapshot"] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}

/** Live utilisation for every category on one date, for the calling magistrate. */
export function useDocketCapacitySnapshot(date: string | undefined) {
  return useQuery({
    queryKey: docketCapacityKeys.snapshot(date ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_docket_capacity_snapshot", {
        p_scheduled_date: date as string,
      });
      if (error) throw error;
      return data;
    },
    enabled: !!date,
  });
}

export function useNextAvailableDocketDate() {
  return useMutation({
    mutationFn: async ({
      categoryId,
      startDate,
    }: {
      categoryId: string;
      startDate: string;
    }) => {
      const { data, error } = await supabase.rpc("find_next_available_docket_date", {
        p_category_id: categoryId,
        p_start_date: startDate,
      });
      if (error) throw error;
      return data;
    },
  });
}

export interface ScheduleDocketEventInput {
  eventId?: string | null;
  docketMatterId: string;
  scheduledDate: string;
  scheduledTime?: string | null;
  eventType?: string | null;
  stageAtEvent?: string | null;
  outcomeAtEvent?: string | null;
  ordersMadeAtEvent?: string | null;
  notes?: string | null;
  location?: string | null;
  eventStatus: string;
  categoryId?: string | null;
  acknowledgeOverride?: boolean;
  overrideReason?: string | null;
}

/**
 * The capacity-aware create/update path — always used by DocketEventDialog
 * instead of the plain useCreateDocketEvent/useUpdateDocketEvent mutations,
 * so both entry points (the matter's own Events tab, and the Docket board's
 * "Log appearance" shortcut) get capacity checking for free. Returns the
 * raw RPC row rather than throwing/toasting on a "capacity_reached" result
 * — the caller decides whether that's an error or a prompt to confirm.
 */
export function useScheduleDocketEventWithCapacity(matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ScheduleDocketEventInput): Promise<ScheduleWithCapacityResult> => {
      const { data, error } = await supabase.rpc("schedule_docket_event_with_capacity", {
        p_event_id: input.eventId ?? undefined,
        p_docket_matter_id: input.docketMatterId,
        p_scheduled_date: input.scheduledDate,
        p_scheduled_time: input.scheduledTime ?? undefined,
        p_event_type: input.eventType ?? undefined,
        p_stage_at_event: input.stageAtEvent ?? undefined,
        p_outcome_at_event: input.outcomeAtEvent ?? undefined,
        p_orders_made_at_event: input.ordersMadeAtEvent ?? undefined,
        p_notes: input.notes ?? undefined,
        p_location: input.location ?? undefined,
        p_event_status: input.eventStatus,
        p_category_id: input.categoryId ?? undefined,
        p_acknowledge_override: input.acknowledgeOverride ?? false,
        p_override_reason: input.overrideReason ?? undefined,
      });
      if (error) throw error;
      const row = data?.[0];
      if (!row) throw new Error("No response from the scheduling function.");
      return row;
    },
    onSuccess: (result) => {
      if (result.status === "created") {
        toast.success("Event saved.");
        void queryClient.invalidateQueries({ queryKey: ["docket-events", matterId] });
        void queryClient.invalidateQueries({ queryKey: ["docket-capacity-snapshot"] });
      }
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}

export interface SetNextDateInput {
  docketMatterId: string;
  scheduledDate: string;
  categoryId?: string | null;
  acknowledgeOverride?: boolean;
  overrideReason?: string | null;
}

/**
 * Sets/changes a matter's Next Date from anywhere in the app — the Docket
 * board's inline editor and the Hearing Progress dialog both use this same
 * mutation, so both write through the identical capacity-checked,
 * history-preserving path (0078) rather than each inventing their own.
 * Invalidates the board/list (Next Date column), the matter detail
 * (Overview), the matter's own events (Hearing Progress), and every
 * capacity snapshot (month calendar) — all four surfaces this single
 * value is displayed in.
 */
export function useSetDocketMatterNextDate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetNextDateInput): Promise<SetNextDateResult> => {
      const { data, error } = await supabase.rpc("set_docket_matter_next_date", {
        p_docket_matter_id: input.docketMatterId,
        p_scheduled_date: input.scheduledDate,
        p_category_id: input.categoryId ?? undefined,
        p_acknowledge_override: input.acknowledgeOverride ?? false,
        p_override_reason: input.overrideReason ?? undefined,
      });
      if (error) throw error;
      const row = data?.[0];
      if (!row) throw new Error("No response from the scheduling function.");
      return row;
    },
    onSuccess: (result, variables) => {
      if (result.status === "created") {
        toast.success("Next date saved.");
        void queryClient.invalidateQueries({ queryKey: ["docket-matters"] });
        void queryClient.invalidateQueries({ queryKey: ["docket-events", variables.docketMatterId] });
        void queryClient.invalidateQueries({ queryKey: ["docket-capacity-snapshot"] });
      }
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });
}
