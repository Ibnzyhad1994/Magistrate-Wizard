import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useKeysetList } from "@/hooks/use-keyset-list";
import {
  applyKeyset,
  type KeysetCursor,
  type KeysetSpec,
  toKeysetPage,
} from "@/lib/keyset-pagination";
import { deleteThenCleanStorage } from "@/lib/storage-cleanup";
import { toast } from "sonner";
import type { Database, TablesUpdate } from "@/types/database.types";

export const judgmentsKeys = {
  all: ["judgments"] as const,
  list: ["judgments", "list"] as const,
  detail: (id: string) => ["judgments", "detail", id] as const,
};

export const judgmentVersionsKeys = {
  list: (judgmentId: string) => ["judgment-versions", judgmentId] as const,
};

/** Newest edit first; `id` breaks ties so paging never skips or repeats a row. */
export const JUDGMENTS_LIST_PAGE: KeysetSpec = {
  columns: [
    { column: "updated_at", ascending: false },
    { column: "id", ascending: false },
  ],
  pageSize: 200,
};

/**
 * One page of `useJudgments`; the total is counted on the first page only.
 *
 * Every Judgment the caller can currently see (RLS: owner OR
 * is_discoverable — never another user's private draft/final), split
 * client-side into the three list sections. No admin bypass, no
 * separate "all judgments" query.
 */
export async function fetchJudgmentsPage(
  client: SupabaseClient<Database>,
  cursor: KeysetCursor | null,
) {
  const { data, error, count } = await applyKeyset(
    client
      .from("judgments")
      .select(
        "id, title, case_number, citation, court_name, judgment_date, status, is_discoverable, owner_id, updated_at, category_id, legal_case_categories(name)",
        { count: cursor ? undefined : "exact" },
      ),
    JUDGMENTS_LIST_PAGE,
    cursor,
  );
  if (error) throw error;
  return toKeysetPage(data ?? [], JUDGMENTS_LIST_PAGE, count);
}

/**
 * Keyset-paged (BE-15): `data` is every row loaded so far, starting with
 * the first page of 200; `fetchNextPage`/`hasNextPage` load the rest and
 * `totalCount` says how many there are. `enabled` defaults to true -- pass
 * `{ enabled: false }` to skip fetching (e.g. dashboard-page.tsx never
 * queries Judgments for a clerk, who has no access to them).
 */
export function useJudgments(options?: { enabled?: boolean }) {
  return useKeysetList({
    queryKey: judgmentsKeys.list,
    fetchPage: (cursor) => fetchJudgmentsPage(supabase, cursor),
    enabled: options?.enabled,
  });
}

export function useJudgment(id: string | undefined) {
  return useQuery({
    queryKey: judgmentsKeys.detail(id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("judgments")
        .select("*")
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

interface CreateJudgmentInput {
  title: string;
  case_number: string | null;
  court_name: string | null;
  judgment_date: string | null;
  citation: string | null;
}

export function useCreateJudgment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateJudgmentInput) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { data, error } = await supabase
        .from("judgments")
        .insert({ ...values, owner_id: user.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Draft judgment created.");
      void queryClient.invalidateQueries({ queryKey: judgmentsKeys.all });
    },
  });
}

/** Substantive-field edits — only valid while the Judgment is a draft (DB-enforced). */
export function useUpdateJudgmentFields(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      values: Omit<TablesUpdate<"judgments">, "status" | "finalized_at" | "finalized_by">,
    ) => {
      const { data, error } = await supabase
        .from("judgments")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Judgment saved.");
      void queryClient.invalidateQueries({ queryKey: judgmentsKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: judgmentsKeys.all });
      void queryClient.invalidateQueries({ queryKey: judgmentVersionsKeys.list(id) });
    },
  });
}

/** Quiet PATCH for category_id — caller owns the toast (the automatic tag/category proposal flow summarizes tags + category in one message rather than firing a second "Judgment saved."). Not locked by protect_judgment_lifecycle() (0075) — works regardless of draft/final status, like useSetJudgmentDiscoverable. */
export function useSetJudgmentCategory(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (category_id: string | null) => {
      const { error } = await supabase.from("judgments").update({ category_id }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: judgmentsKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: judgmentsKeys.all });
    },
  });
}

export function useSetJudgmentDiscoverable(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (is_discoverable: boolean) => {
      const { error } = await supabase.from("judgments").update({ is_discoverable }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Discoverability updated.");
      void queryClient.invalidateQueries({ queryKey: judgmentsKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: judgmentsKeys.all });
    },
  });
}

/**
 * Finalize / Unlock are each their OWN, single-field UPDATE — the
 * backend's `protect_judgment_lifecycle()` trigger rejects a single
 * UPDATE that combines an unlock with any substantive edit, so these
 * must never be merged with `useUpdateJudgmentFields`.
 */
export function useFinalizeJudgment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("judgments").update({ status: "final" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Judgment finalised.");
      void queryClient.invalidateQueries({ queryKey: judgmentsKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: judgmentsKeys.all });
    },
  });
}

export function useUnlockJudgment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("judgments").update({ status: "draft" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Judgment unlocked for editing.");
      // Refetch (not just invalidate) before the editor re-enables, per
      // the "refresh row before re-enabling editor" requirement.
      await queryClient.invalidateQueries({ queryKey: judgmentsKeys.detail(id) });
      await queryClient.refetchQueries({ queryKey: judgmentsKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: judgmentsKeys.all });
    },
  });
}

/** Draft-only, per the live DELETE policy (`can_edit_judgment(id) AND status = 'draft'`). */
export function useDeleteJudgment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      deleteThenCleanStorage(supabase, () => supabase.from("judgments").delete().eq("id", id)),
    onSuccess: () => {
      toast.success("Draft deleted.");
      void queryClient.invalidateQueries({ queryKey: judgmentsKeys.all });
    },
  });
}
