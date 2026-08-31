import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";
import { uploadDocumentToEntity } from "@/hooks/use-documents";
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
          "id, code, title, short_title, jurisdiction, effective_date, chapter_number, act_number, enactment_year, instrument_type, review_status, updated_at, primary_document_id, page_count, is_current_version",
        )
        .order("title", { ascending: true })
        .limit(500);
      if (error) throw error;
      // A superseded row (is_current_version === false, 0098) stays fully
      // reachable from the superseding record's detail page, but drops out
      // of the ordinary library view -- only the current version of each
      // Act belongs in the main list. Legacy rows predating 0055 have
      // is_current_version defaulting true, so `!== false` (not `=== true`)
      // correctly treats a missing/null value as current.
      return (data ?? []).filter(
        (row) => row.review_status === "published" && row.is_current_version !== false,
      );
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

/**
 * File-first Legislation upload (0098) -- the ONLY path new Legislation
 * uploads take now. Admins and magistrates may create; only admins may
 * replace an existing Act. No text extraction, no chunking, no
 * import_jobs row: the original PDF is stored unchanged and becomes the
 * record's `primary_document_id`. `finalize_legislation_document`
 * (0098/0114) links+publishes atomically.
 *
 * Cleanup on failure, mirroring `useRejectCanonicalStatute`'s existing
 * storage-then-metadata order:
 *   - The file upload/`documents` insert fails -> `uploadDocumentToEntity`
 *     has already cleaned up any Storage orphan itself; this hook then
 *     deletes the now file-less draft `statutes` row so nothing broken is
 *     left in the library.
 *   - The finalize RPC fails (uploaded fine, but couldn't be linked/
 *     published) -> the uploaded document's Storage blob + `documents`
 *     row are removed, then the draft `statutes` row is deleted.
 * Either way, a failed upload never leaves a broken Legislation record,
 * and a failed database step never leaves an orphaned Storage object.
 */
export function useCreateLegislationDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      values: Partial<StatuteInsert> & { code: string; title: string; jurisdiction: string };
      file: File;
      pageCount: number | null;
      hasTextLayer: boolean | null;
    }) => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getUser();
      if (sessionError) throw sessionError;
      const createdBy = sessionData.user?.id;
      if (!createdBy) throw new Error("You must be signed in to upload legislation.");

      const { data: statute, error: createError } = await supabase
        .from("statutes")
        .insert({
          ...input.values,
          created_by: createdBy,
          review_status: "draft",
          // A replacement's draft row must NOT default to
          // is_current_version=true (the column default): the row it
          // supersedes is still true at this moment, and
          // statutes_code_jurisdiction_current_idx (0098) would reject
          // two "current" rows sharing the same code+jurisdiction right
          // here at INSERT time, before finalize_legislation_document
          // ever runs to demote the old one. finalize (0099) promotes
          // this row to current only AFTER demoting the superseded row,
          // both within its own transaction.
          is_current_version: input.values.supersedes_statute_id ? false : true,
        })
        .select()
        .single();
      if (createError) throw createError;

      let document: { id: string; file_path: string };
      try {
        document = await uploadDocumentToEntity("statute", statute.id, input.file);
      } catch (uploadError) {
        await supabase.from("statutes").delete().eq("id", statute.id);
        throw uploadError;
      }

      const { error: finalizeError } = await supabase.rpc("finalize_legislation_document", {
        p_statute_id: statute.id,
        p_document_id: document.id,
        p_page_count: input.pageCount ?? undefined,
        p_has_text_layer: input.hasTextLayer ?? undefined,
      });
      if (finalizeError) {
        const { error: removeError } = await supabase.storage.from("documents").remove([document.file_path]);
        if (removeError) {
          console.error("Storage cleanup failed after a failed Legislation finalize step:", removeError);
        } else {
          await supabase.from("documents").delete().eq("id", document.id);
        }
        await supabase.from("statutes").delete().eq("id", statute.id);
        throw finalizeError;
      }

      return statute.id as string;
    },
    onSuccess: () => {
      toast.success("Legislation uploaded and published.");
      void queryClient.invalidateQueries({ queryKey: legislationKeys.all });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

/** The `documents` row backing `statutes.primary_document_id` -- file_path/file_name the PDF viewer needs to load and label the document. RLS is identical to any other `documents` row (`can_view_statute`, 0091/0093) -- no extra check needed here. */
export function usePrimaryLegislationDocument(documentId: string | null | undefined) {
  return useQuery({
    queryKey: ["legislation", "primary-document", documentId ?? ""],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, file_path, file_name, file_size")
        .eq("id", documentId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!documentId,
  });
}

/** The record (if any) that supersedes this one -- 0098 version chain. Used by the detail page's "a newer version exists" banner. */
export function useSupersedingStatute(statuteId: string | undefined) {
  return useQuery({
    queryKey: ["legislation", "superseding-by", statuteId ?? ""],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("statutes")
        .select("id, title")
        .eq("supersedes_statute_id", statuteId as string)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!statuteId,
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
        p_reason: reason ?? undefined,
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
 * Admin-only: permanently deletes a canonical Legislation record AT ANY
 * review_status, including published — distinct from
 * `useRejectCanonicalStatute` above, which is specifically the
 * reject-a-draft-import workflow step (clears the linked import_jobs row,
 * named for that meaning). RLS already permits an admin to delete any
 * canonical `statutes` row unconditionally ("Admins can delete statutes",
 * 0012) — this hook adds the Storage cleanup step a raw DELETE can't do
 * (SQL only cascades the `documents` METADATA row via
 * `documents_parent_cascade_delete`, never the underlying Storage blob;
 * `statute_provisions` cascade automatically via their own FK). Attempting
 * this as a non-admin fails at the RLS layer with a normal Postgres error,
 * surfaced through the same toast as any other mutation failure.
 */
export function useDeleteCanonicalStatute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
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
          console.error("Storage cleanup failed during canonical Legislation deletion:", removeError);
          throw new Error(
            `Could not remove ${docs.length} attached file(s) from storage. The record was left in place so nothing is silently lost -- retry deletion once storage cleanup succeeds.`,
          );
        }
      }

      const { error } = await supabase.from("statutes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Legislation record deleted.");
      void queryClient.invalidateQueries({ queryKey: legislationKeys.all });
      void queryClient.invalidateQueries({ queryKey: legislationKeys.reviewQueue });
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
