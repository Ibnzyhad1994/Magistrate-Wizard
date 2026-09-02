import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { Database, TablesInsert, TablesUpdate } from "@/types/database.types";
import {
  currentStage,
  filtersToRpcArgs,
  type ProcedureFilters,
  type ProcedureSnapshot,
} from "@/lib/docket-procedure";
import { isQueueableError, MATTER_UNAVAILABLE_OFFLINE } from "@/lib/offline/is-queueable-error";
import { currentProfileId } from "@/lib/offline/runtime";
import { getProfileCache } from "@/lib/offline/store";
import { seedMatterDetail } from "@/lib/offline/seed";
import { ConcurrentEditError } from "@/lib/concurrency";

export const docketMattersKeys = {
  all: ["docket-matters"] as const,
  list: (search: string) => ["docket-matters", "list", search] as const,
  board: (search: string, filters: ProcedureFilters, exactDate: string | null, courtId: string | null) =>
    ["docket-matters", "board", search, filters, exactDate, courtId] as const,
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
          "id, case_number, matter_title, status, charge_or_issue, created_at, updated_at, court_id, district_id, cover_image_path, courts(name)",
        )
        .is("deleted_at", null)
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
      try {
        const { data, error } = await supabase
          .from("docket_matters")
          .select(
            "*, courts(id, name, jurisdiction), magisterial_districts(id, name)",
          )
          .eq("id", id as string)
          .maybeSingle();
        if (error) throw error;
        if (data) {
          const profileId = await currentProfileId();
          if (profileId) {
            await seedMatterDetail(profileId, {
              ...data,
              courts: data.courts ?? null,
              magisterial_districts: data.magisterial_districts ?? null,
            });
          }
        }
        return data;
      } catch (error) {
        if (!isQueueableError(error) || !id) throw error;
        const profileId = await currentProfileId();
        const cached = getProfileCache(profileId ?? undefined).matters[id];
        if (cached?.detail) {
          return {
            ...cached.detail,
            courts: cached.detail.courts ?? null,
            magisterial_districts: cached.detail.magisterial_districts ?? null,
          };
        }
        throw new Error(MATTER_UNAVAILABLE_OFFLINE);
      }
    },
    enabled: !!id,
    retry: (failureCount, error) => !isQueueableError(error) && failureCount < 1,
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

/**
 * `expectedUpdatedAt`, when supplied, adds `.eq("updated_at", ...)`
 * alongside `.eq("id", id)` — the existing `updated_at` column doubles as
 * an optimistic-concurrency version marker, no schema change needed. If
 * another authorized user (magistrate or clerk) changed this matter since
 * the caller last read it, zero rows match and this throws
 * ConcurrentEditError instead of silently overwriting their change.
 * Callers that don't pass it (existing quick actions with no stale-data
 * risk worth gating) keep today's unconditional-update behavior exactly.
 */
export function useUpdateDocketMatter(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      values,
      expectedUpdatedAt,
    }: {
      values: TablesUpdate<"docket_matters">;
      expectedUpdatedAt?: string | null;
    }) => {
      let query = supabase.from("docket_matters").update(values).eq("id", id);
      if (expectedUpdatedAt) {
        query = query.eq("updated_at", expectedUpdatedAt);
      }
      const { data, error } = await query.select().maybeSingle();
      if (error) throw error;
      if (!data) {
        if (expectedUpdatedAt) throw new ConcurrentEditError();
        throw new Error("This matter could not be found, or you no longer have access to it.");
      }
      return data;
    },
    onSuccess: () => {
      toast.success("Docket matter updated.");
      void queryClient.invalidateQueries({
        queryKey: docketMattersKeys.detail(id),
      });
      void queryClient.invalidateQueries({ queryKey: docketMattersKeys.all });
    },
    onError: (error) => {
      if (error instanceof ConcurrentEditError) {
        // Surfaced by the caller's own conflict UI, not the generic toast
        // subscriber -- refetch so the review shows the true latest state.
        void queryClient.invalidateQueries({ queryKey: docketMattersKeys.detail(id) });
      }
    },
  });
}

export type DocketMatterBoardRow =
  Database["public"]["Functions"]["list_docket_matters"]["Returns"][number];

/**
 * Spreadsheet / filtered Docket list. Uses list_docket_matters so stage
 * filters apply server-side (the 100-row cap still shows the right files).
 * `exactDate` (0079) is the calendar's currently-selected date — when set,
 * this is the SAME next_appearance value the capacity calendar counts
 * against, so the list and the calendar can never disagree about which
 * matters belong to a given date. `null` means unfiltered ("All Matters").
 * `courtId` (0097) is the two-level Docket scope -- `null` means "All My
 * Courts" (every court the caller is currently authorized to access, via
 * RLS -- never every court in the database); a specific id restricts to
 * that exact court. Included in the query key so switching scope is a
 * genuinely separate cache entry, never a stale cross-court flash.
 */
export function useDocketMatterBoard(
  search: string,
  filters: ProcedureFilters,
  exactDate: string | null,
  courtId: string | null,
  options?: { enabled?: boolean },
) {
  const trimmed = search.trim();
  return useQuery({
    queryKey: docketMattersKeys.board(trimmed, filters, exactDate, courtId),
    enabled: options?.enabled,
    queryFn: async () => {
      const args = filtersToRpcArgs(filters);
      const { data, error } = await supabase.rpc("list_docket_matters", {
        p_query: trimmed,
        p_limit: 100,
        p_exact_date: exactDate ?? undefined,
        p_court_id: courtId ?? undefined,
        ...args,
      });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Quiet PATCH for procedure cells — caller owns the toast. Same
 * `expectedUpdatedAt` optimistic-concurrency check as
 * useUpdateDocketMatter (see its comment) — a clerk and magistrate
 * tapping the same stage cell in quick succession must not silently
 * overwrite one another.
 */
export function usePatchDocketProcedure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      values,
      expectedUpdatedAt,
    }: {
      id: string;
      values: TablesUpdate<"docket_matters">;
      expectedUpdatedAt?: string | null;
    }) => {
      let query = supabase.from("docket_matters").update(values).eq("id", id);
      if (expectedUpdatedAt) {
        query = query.eq("updated_at", expectedUpdatedAt);
      }
      const { data, error } = await query.select().maybeSingle();
      if (error) throw error;
      if (!data) {
        if (expectedUpdatedAt) throw new ConcurrentEditError();
        throw new Error("This matter could not be found, or you no longer have access to it.");
      }
      return data;
    },
    onMutate: async ({ id, values }) => {
      await queryClient.cancelQueries({ queryKey: docketMattersKeys.all });
      const previous = queryClient.getQueriesData<DocketMatterBoardRow[]>({
        queryKey: ["docket-matters", "board"],
      });
      queryClient.setQueriesData<DocketMatterBoardRow[]>(
        { queryKey: ["docket-matters", "board"] },
        (old) => {
          if (!old) return old;
          return old.map((row): DocketMatterBoardRow => {
            if (row.id !== id) return row;
            const next = { ...row, ...values };
            const snapshot: ProcedureSnapshot = {
              arraignment_status: next.arraignment_status as ProcedureSnapshot["arraignment_status"],
              custody_status: next.custody_status as ProcedureSnapshot["custody_status"],
              disclosure_status: next.disclosure_status as ProcedureSnapshot["disclosure_status"],
              trial_status: next.trial_status as ProcedureSnapshot["trial_status"],
              ruling_status: next.ruling_status as ProcedureSnapshot["ruling_status"],
              judgment_status: next.judgment_status as ProcedureSnapshot["judgment_status"],
              sentence_status: next.sentence_status as ProcedureSnapshot["sentence_status"],
              appeal_status: next.appeal_status as ProcedureSnapshot["appeal_status"],
            };
            return { ...row, ...values, procedure_stage: currentStage(snapshot) } as DocketMatterBoardRow;
          });
        },
      );
      return { previous, id };
    },
    onError: (_error, _values, context) => {
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: docketMattersKeys.all });
      void queryClient.invalidateQueries({
        queryKey: docketMattersKeys.detail(variables.id),
      });
    },
  });
}

export type BinnedDocketMatterRow =
  Database["public"]["Functions"]["list_binned_docket_matters"]["Returns"][number];

function invalidateAfterBinChange(
  queryClient: ReturnType<typeof useQueryClient>,
  id?: string,
) {
  void queryClient.invalidateQueries({ queryKey: docketMattersKeys.all });
  if (id) {
    void queryClient.invalidateQueries({ queryKey: docketMattersKeys.detail(id) });
  }
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  void queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
}

export function useBinnedDocketMatters() {
  return useQuery({
    queryKey: [...docketMattersKeys.all, "bin"] as const,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_binned_docket_matters");
      if (error) throw error;
      return data;
    },
  });
}

export function useBinDocketMatter(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("bin_docket_matter", { p_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Matter moved to the bin. It will be permanently deleted after 7 days.");
      invalidateAfterBinChange(queryClient, id);
    },
  });
}

export function useRestoreDocketMatter(id?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (matterId: string) => {
      const { data, error } = await supabase.rpc("restore_docket_matter", {
        p_id: matterId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, matterId) => {
      toast.success("Matter restored to the docket.");
      invalidateAfterBinChange(queryClient, id ?? matterId);
    },
  });
}

export function usePurgeDocketMatter(id?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (matterId: string) => {
      const { error } = await supabase.rpc("purge_docket_matter", { p_id: matterId });
      if (error) throw error;
    },
    onSuccess: (_data, matterId) => {
      toast.success("Matter permanently deleted.");
      invalidateAfterBinChange(queryClient, id ?? matterId);
    },
  });
}
