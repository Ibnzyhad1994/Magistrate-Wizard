import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";
import type { TablesInsert, TablesUpdate } from "@/types/database.types";

// Mirrors importJobKeys.all in use-import-jobs.ts (that module imports
// legislationKeys FROM this one -- a circular import back here for one
// literal array isn't worth the fragility).
const importJobsQueryKey = ["import-jobs"] as const;

/**
 * Frontend surface for the `statutes` table (0005, extended by 0055 with
 * structural/provenance/review columns) — the institutional/canonical
 * Legislation table, admin-write-only per its RLS (0005/0012/0055).
 *
 * As of 0055 this also covers `statute_provisions` (Part/Chapter/Section/
 * Subsection/Paragraph/Schedule hierarchy, self-referencing, tolerant of
 * missing levels) and the admin-only "draft-row-first" ingestion path:
 * `useCreateCanonicalStatute` creates the real row immediately with
 * review_status='draft' so a source document and provisions can be
 * attached to its real id before publish, exactly mirroring the Case Law
 * ingestion hooks in `use-case-law.ts`.
 */
export const legislationKeys = {
  all: ["legislation"] as const,
  detail: (id: string) => ["legislation", "detail", id] as const,
  reviewQueue: ["legislation", "review-queue"] as const,
  provisions: (statuteId: string) => ["legislation", "provisions", statuteId] as const,
};

/**
 * Published Legislation only — draft/needs_review rows (in-progress
 * ingestion) are excluded from the ordinary browse experience, same
 * pattern as `useCaseLawList`. Surfaced separately via
 * `useLegislationReviewQueue` for admins.
 */
export function useStatutes() {
  return useQuery({
    queryKey: legislationKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("statutes")
        .select(
          "id, code, title, short_title, jurisdiction, effective_date, chapter_number, act_number, review_status, updated_at",
        )
        .order("title", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []).filter((row) => row.review_status === "published");
    },
  });
}

export function useStatute(id: string | undefined) {
  return useQuery({
    queryKey: legislationKeys.detail(id ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("statutes")
        .select("*")
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

/**
 * Admin-only: canonical Legislation rows still in the ingestion pipeline.
 * `duplicate_warning` lives on `import_jobs`, joined via the
 * `statutes.import_job_id` FK in one query (see the identical pattern/
 * rationale on `useCaseLawReviewQueue`).
 */
export function useLegislationReviewQueue() {
  return useQuery({
    queryKey: legislationKeys.reviewQueue,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("statutes")
        .select(
          "*, import_jobs!statutes_import_job_id_fkey(duplicate_warning, proposed_tags, uploaded_document_id, status, extracted_metadata, error_summary)",
        )
        .in("review_status", ["draft", "needs_review"])
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => {
        const job = row.import_jobs as unknown as {
          duplicate_warning: string | null;
          proposed_tags: string[] | null;
          uploaded_document_id: string | null;
          status: string;
          extracted_metadata: unknown;
          error_summary: string | null;
        } | null;
        return {
          ...row,
          duplicate_warning: job?.duplicate_warning ?? null,
          proposed_tags: job?.proposed_tags ?? [],
          uploaded_document_id: job?.uploaded_document_id ?? null,
          job_status: job?.status ?? null,
          extracted_metadata: job?.extracted_metadata ?? null,
          job_error_summary: job?.error_summary ?? null,
        };
      });
    },
  });
}

type StatuteInsert = TablesInsert<"statutes">;
type StatuteUpdate = TablesUpdate<"statutes">;

/**
 * Admin-only: creates a draft canonical Legislation row (manual entry or
 * the first step of file/URL ingestion — "draft-row-first", see
 * use-case-law.ts for the identical rationale). `code` remains required
 * (existing unique(code, jurisdiction) constraint from 0005) — for
 * ingested Acts, propose the chapter/Act number as the code when the
 * curator has not supplied one.
 */
export function useCreateCanonicalStatute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      values: Partial<StatuteInsert> & { code: string; title: string; jurisdiction: string },
    ) => {
      const { data, error } = await supabase
        .from("statutes")
        .insert({ ...values, review_status: "draft" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Draft Act created.");
      void queryClient.invalidateQueries({ queryKey: legislationKeys.reviewQueue });
    },
  });
}

export function useUpdateCanonicalStatute(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: StatuteUpdate) => {
      const { data, error } = await supabase
        .from("statutes")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Saved.");
      void queryClient.invalidateQueries({ queryKey: legislationKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: legislationKeys.reviewQueue });
      void queryClient.invalidateQueries({ queryKey: legislationKeys.all });
    },
  });
}

/**
 * Admin-only: moves a draft/needs_review row through the review workflow.
 * 'published' routes through `publish_legislation_import` (0058), which
 * atomically flips both statutes.review_status AND its linked
 * import_jobs.status. The other three go through
 * `set_legislation_review_status` (0059), keeping the job's status in
 * lockstep wherever the vocabularies overlap.
 */
export function useSetStatuteReviewStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      review_status,
    }: {
      id: string;
      review_status: "draft" | "needs_review" | "ready" | "published";
    }) => {
      if (review_status === "published") {
        const { error } = await supabase.rpc("publish_legislation_import", {
          p_statute_id: id,
        });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.rpc("set_legislation_review_status", {
        p_statute_id: id,
        p_status: review_status,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      toast.success(
        variables.review_status === "published" ? "Published." : "Status updated.",
      );
      void queryClient.invalidateQueries({ queryKey: legislationKeys.reviewQueue });
      void queryClient.invalidateQueries({ queryKey: legislationKeys.all });
      void queryClient.invalidateQueries({ queryKey: legislationKeys.detail(variables.id) });
      void queryClient.invalidateQueries({ queryKey: importJobsQueryKey });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

/**
 * Admin-only: rejects a draft Act via `reject_legislation_import` (0058),
 * which atomically reconciles the linked import_jobs row BEFORE deleting
 * the statutes row (statute_provisions cascade via their own FK; attached
 * `documents` metadata cascades via the 0058-fixed trigger). The caller
 * must remove any attached Storage object(s) FIRST -- SQL cannot delete a
 * Storage blob, only the metadata row.
 */
export function useRejectCanonicalStatute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string | null }) => {
      const { data: docs, error: docsError } = await supabase
        .from("documents")
        .select("file_path")
        .eq("entity_type", "statute")
        .eq("entity_id", id);
      if (docsError) throw docsError;
      if (docs && docs.length > 0) {
        const { error: removeError } = await supabase.storage
          .from("documents")
          .remove(docs.map((d) => d.file_path));
        if (removeError) {
          // Deliberately does not interpolate removeError.message -- that's
          // raw Supabase Storage API text, not something a curator should
          // ever see (Section 38: no raw internals in user-facing errors).
          console.error("Storage cleanup failed during legislation rejection:", removeError);
          throw new Error(
            `Could not remove ${docs.length} attached file(s) from storage. The draft was left in place so nothing is silently lost -- retry rejection once storage cleanup succeeds.`,
          );
        }
      }

      const { error } = await supabase.rpc("reject_legislation_import", {
        p_statute_id: id,
        p_reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Draft rejected and removed.");
      void queryClient.invalidateQueries({ queryKey: legislationKeys.reviewQueue });
      void queryClient.invalidateQueries({ queryKey: importJobsQueryKey });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

/**
 * Ordered Part/Chapter/Section/Subsection/Paragraph/Schedule hierarchy for
 * one Act. Ordered by `sort_order` (document order) so the caller can
 * build a tree client-side from `parent_provision_id` without an extra
 * round trip — instrument sizes here (tens to low hundreds of provisions
 * per Act) make client-side tree assembly reasonable; this does not scale
 * to loading an entire multi-thousand-Act library, which is why this
 * hook is scoped to a single statute id.
 */
export function useStatuteProvisions(statuteId: string | undefined) {
  return useQuery({
    queryKey: legislationKeys.provisions(statuteId ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("statute_provisions")
        .select("*")
        .eq("statute_id", statuteId as string)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!statuteId,
  });
}

export function useCreateProvision(statuteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: Omit<TablesInsert<"statute_provisions">, "statute_id">) => {
      const { data, error } = await supabase
        .from("statute_provisions")
        .insert({ ...values, statute_id: statuteId })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: legislationKeys.provisions(statuteId) });
    },
  });
}

export function useUpdateProvision(statuteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      values,
    }: {
      id: string;
      values: TablesUpdate<"statute_provisions">;
    }) => {
      const { data, error } = await supabase
        .from("statute_provisions")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: legislationKeys.provisions(statuteId) });
    },
  });
}

export function useDeleteProvision(statuteId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("statute_provisions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: legislationKeys.provisions(statuteId) });
    },
  });
}
