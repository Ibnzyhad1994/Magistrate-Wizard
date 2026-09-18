import { useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth-store";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { Database, TablesInsert, TablesUpdate } from "@/types/database.types";
import {
  EMPTY_PROCEDURE_FILTERS,
  filtersToRpcArgs,
  hasActiveProcedureFilters,
  type ProcedureFilters,
} from "@/lib/docket-procedure";
import { matterProtocolStage } from "@/lib/docket-protocols";
import {
  isKnownOffline,
  isQueueableError,
  MATTER_UNAVAILABLE_OFFLINE,
} from "@/lib/offline/is-queueable-error";
import { enqueueQueuedMatterPatch } from "@/lib/offline/runtime";
import { currentProfileId } from "@/lib/offline/runtime";
import { getProfileCache, subscribeOfflineStore } from "@/lib/offline/store";
import { boardCacheKey, getCachedBoard } from "@/lib/offline/docket-cache";
import { seedBoard, seedMatterDetail } from "@/lib/offline/seed";
import { ConcurrentEditError } from "@/lib/concurrency";

export const docketMattersKeys = {
  all: ["docket-matters"] as const,
  list: (search: string) => ["docket-matters", "list", search] as const,
  board: (
    search: string,
    filters: ProcedureFilters,
    exactDate: string | null,
    courtId: string | null,
  ) => ["docket-matters", "board", search, filters, exactDate, courtId] as const,
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
          .select("*, courts(id, name, jurisdiction), magisterial_districts(id, name)")
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
 * `exactDate` is the calendar day on the capacity strip: matters with any
 * non-error appearance that day (0139 keeps Next-date chips from ANDing
 * against it). Calendar tiles count every court you sit; clicking a day
 * switches this list to All My Courts (`courtId` null). `null` exactDate
 * means "All Matters" and still follows the heading court. `courtId` (0097)
 * is the two-level Docket scope -- `null` means "All My Courts" (every
 * court the caller is currently authorized to access, via RLS -- never
 * every court in the database); a specific id restricts to that exact
 * court. Included in the query key so switching scope is a genuinely
 * separate cache entry, never a stale cross-court flash.
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
      // A board saved before the sitting is only used for the plain,
      // unfiltered view of that scope: a cached list cannot honour a
      // search or a stage filter, and quietly returning an unfiltered
      // list under a filtered heading would misrepresent the docket.
      const cacheable = !trimmed && !hasActiveProcedureFilters(filters);
      try {
        const { data, error } = await supabase.rpc("list_docket_matters", {
          p_query: trimmed,
          p_limit: 100,
          p_exact_date: exactDate ?? undefined,
          p_court_id: courtId ?? undefined,
          ...args,
        });
        if (error) throw error;
        if (cacheable && data) {
          const profileId = await currentProfileId();
          if (profileId) await seedBoard(profileId, boardCacheKey(courtId, exactDate), data);
        }
        return data;
      } catch (error) {
        if (!isQueueableError(error) || !cacheable) throw error;
        const profileId = await currentProfileId();
        const cached = profileId
          ? getCachedBoard(getProfileCache(profileId), boardCacheKey(courtId, exactDate))
          : null;
        if (!cached) throw error;
        return cached.rows as DocketMatterBoardRow[];
      }
    },
    /**
     * Keeps the previous results on screen while a REFINEMENT (search
     * text, stage filters, selected date) reloads, so narrowing the board
     * dims the list instead of blanking it to a skeleton.
     *
     * Deliberately scoped to the same court: `courtId` is the last segment
     * of the board key, and carrying one court's matters over into another
     * court's view — under that court's own heading — would misrepresent
     * whose docket is on screen. A scope switch keeps the honest skeleton.
     */
    placeholderData: (previousData, previousQuery) => {
      const previousCourtId = previousQuery?.queryKey?.[5];
      return previousCourtId === courtId ? previousData : undefined;
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
      const queueChange = async () => {
        const cached = queryClient
          .getQueriesData<DocketMatterBoardRow[]>({ queryKey: ["docket-matters", "board"] })
          .flatMap(([, rows]) => rows ?? [])
          .find((row) => row.id === id);
        await enqueueQueuedMatterPatch({
          matterId: id,
          patch: values,
          caseNumber: cached?.case_number ?? "",
          matterTitle: cached?.matter_title ?? "",
          baseUpdatedAt: expectedUpdatedAt ?? null,
        });
        return { row: null, queued: true as const };
      };

      // Queue straight away when the device knows it is offline, rather
      // than issuing a request the browser will simply hold until the
      // network returns -- that leaves the magistrate with no feedback.
      if (isKnownOffline()) return queueChange();

      let query = supabase.from("docket_matters").update(values).eq("id", id);
      if (expectedUpdatedAt) {
        query = query.eq("updated_at", expectedUpdatedAt);
      }
      try {
        const { data, error } = await query.select().maybeSingle();
        if (error) throw error;
        if (!data) {
          if (expectedUpdatedAt) throw new ConcurrentEditError();
          throw new Error("This matter could not be found, or you no longer have access to it.");
        }
        return { row: data, queued: false as const };
      } catch (error) {
        // Offline, the board change is queued rather than lost. The
        // optimistic paint from onMutate deliberately stays: resolving
        // here means onError never runs, so nothing rolls it back.
        if (!isQueueableError(error)) throw error;
        return queueChange();
      }
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
            return {
              ...row,
              ...values,
              procedure_stage: matterProtocolStage(next),
            } as DocketMatterBoardRow;
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
    onSettled: (data, _error, variables) => {
      // A queued change has nothing to refetch: invalidating would send
      // the board to a server it cannot reach and risk replacing the
      // optimistic value with a stale one.
      if (data?.queued) return;
      void queryClient.invalidateQueries({ queryKey: docketMattersKeys.all });
      void queryClient.invalidateQueries({
        queryKey: docketMattersKeys.detail(variables.id),
      });
    },
  });
}

export type BinnedDocketMatterRow =
  Database["public"]["Functions"]["list_binned_docket_matters"]["Returns"][number];

function invalidateAfterBinChange(queryClient: ReturnType<typeof useQueryClient>, id?: string) {
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

/**
 * Saves the current, unfiltered board for offline use, and reports when
 * that scope was last saved. The prefetch is one RPC call the magistrate
 * asks for, not a background download: on a metered connection that is
 * their decision.
 *
 * Board rows only. Documents, cover images and scanned bundles are
 * deliberately excluded -- they would blow any storage budget, and a
 * board row is what a sitting is actually worked from.
 */
export function useTakeBoardOffline(exactDate: string | null, courtId: string | null) {
  const queryClient = useQueryClient();
  const key = boardCacheKey(courtId, exactDate);
  const savedAt = useSyncExternalStore(
    subscribeOfflineStore,
    () => {
      const profileId = useAuthStore.getState().user?.id;
      if (!profileId) return null;
      return getCachedBoard(getProfileCache(profileId), key)?.savedAt ?? null;
    },
    () => null,
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const profileId = useAuthStore.getState().user?.id;
      if (!profileId) throw new Error("You need to be signed in to save a list offline.");
      const { data, error } = await supabase.rpc("list_docket_matters", {
        p_query: "",
        p_limit: 100,
        p_exact_date: exactDate ?? undefined,
        p_court_id: courtId ?? undefined,
        ...filtersToRpcArgs(EMPTY_PROCEDURE_FILTERS),
      });
      if (error) throw error;
      await seedBoard(profileId, key, data ?? []);
      return (data ?? []).length;
    },
    onSuccess: (count) => {
      toast.success(
        count === 1 ? "1 file saved for offline use." : `${count} files saved for offline use.`,
      );
      void queryClient.invalidateQueries({ queryKey: docketMattersKeys.all });
    },
  });

  return { savedAt, takeOffline: () => mutation.mutate(), isSaving: mutation.isPending };
}
