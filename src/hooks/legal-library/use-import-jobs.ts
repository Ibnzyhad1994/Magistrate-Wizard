import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";
import { interpretDuplicateQuery } from "@/lib/duplicate-check";
import {
  extractCaseLawMetadataWithConfidence,
  extractCaseNameFromFilename,
  extractLegislationHierarchy,
  extractLegislationMetadataWithConfidence,
  findCaseLawDuplicates,
  findStatuteDuplicates,
  normalizeWhitespace,
  proposeTagsScored,
  sha256File,
  sha256Text,
  shouldProposeCaseName,
  toTagProposalDetails,
} from "@/lib/legal-extraction";
import { sanitizeExtractedText } from "@/lib/text-sanitize";
import { emptyExtractionEnvelope, type ExtractionEnvelope } from "@/lib/extraction-pipeline";
import { assessExtractionQuality, CLEAN_SCORE_THRESHOLD, deriveContentQualityStatus } from "@/lib/extraction-quality";
import { ingestDocument } from "@/lib/ingest-document";
import { matchCanonicalCourtScored, type CourtLike } from "@/lib/legal-taxonomy-match";
import {
  mergeReprocessFields,
  readLastMachineProposal,
  type MachineProposal,
} from "@/lib/legal-library/machine-proposal";
import { downloadDocumentAsFile, uploadDocumentToEntity } from "@/hooks/use-documents";
import { caseLawKeys } from "@/hooks/case-law/use-case-law";
import { legislationKeys } from "@/hooks/legislation/use-legislation";
import type { Json, TablesUpdate } from "@/types/database.types";

/**
 * Admin-only CRUD + orchestration over `import_jobs`/`import_batches`
 * (0055) and the transactional ingestion RPCs added in 0058
 * (`create_case_law_import`/`create_legislation_import`).
 *
 * Ingestion design (0058 repair of the 725045c "draft-row-first" flow):
 * the canonical `case_law`/`statutes` draft row, its `statute_provisions`
 * (Legislation only), and the audit `import_jobs` row -- INCLUDING the
 * bidirectional `import_job_id` back-link -- are created by ONE
 * transactional SECURITY DEFINER RPC call, not a sequence of independent
 * `supabase.from(...).insert()` calls. If the RPC raises, nothing is
 * written; there is no partial-draft-without-a-job or job-without-a-
 * backlink state possible from this flow.
 *
 * The ORIGINAL FILE (when supplied) is uploaded through the existing
 * secure `documents` Storage architecture (`uploadDocumentToEntity`,
 * private bucket, signed URLs only) as a SEPARATE step immediately after
 * the RPC returns a real id -- Storage cannot participate in a Postgres
 * transaction, so this is an honest, disclosed two-step boundary, not a
 * false claim of end-to-end atomicity. If the RPC succeeds but the
 * upload fails, the draft/job still exist (nothing is silently lost) and
 * the failure is surfaced to the caller/toast rather than swallowed; the
 * curator can attach the original from the Review Queue afterward.
 *
 * No AI is involved anywhere in this file. PDF text-layer extraction (via
 * src/lib/extraction-pipeline.ts, a quality-gated wrapper around the
 * dependency-free src/lib/pdf-text-extraction.ts parser) is best-effort
 * and browser-only -- see that file's header for exactly what it can and
 * cannot do. DOCX extraction is NOT implemented. Whatever `text` this
 * hook receives -- machine-extracted-and-gated, or curator-pasted -- is
 * defensively re-sanitized immediately below before it can reach
 * Supabase, since PostgreSQL/jsonb cannot store certain byte sequences
 * (NUL bytes, unpaired surrogates) regardless of where they came from.
 * The original file upload and the document text are still two
 * independent things and are never conflated: an original file can be
 * preserved even when no usable text could be extracted from it.
 *
 * `p_extracted_metadata` carries both the deterministic metadata
 * proposal AND (under the `_extraction` key) the full extraction
 * provenance envelope -- status/method/quality/warnings/ocrUsed -- so the
 * Review Queue can show the curator exactly what the machine did and did
 * not manage to determine, without a schema migration (this column was
 * already `jsonb`).
 */
export const importJobKeys = {
  all: ["import-jobs"] as const,
};

/**
 * Creates an `import_batches` row (0055 — already existed before this
 * phase; bulk ingestion is the first feature to actually USE it) so a
 * bulk import can be identified and returned to later — "Bulk import —
 * 12 August 2026 — 143 documents" (Section 13). Admin-only via RLS,
 * same as every other write in this file.
 *
 * `expected_file_count` (0064) is the one authoritative number the batch
 * accounting invariant is checked against: how many files the curator
 * actually selected, recorded once here and never touched again. Every
 * one of those files — including ones rejected by client-side validation
 * before processing even began — must end up as exactly one persisted
 * `import_jobs` row (see `recordBulkRejectedJobs`/`recordBulkNonDraftJob`
 * below). Batches created before this column existed have it `null`; the
 * UI must treat `null` as "legacy, per-file history not reconstructable"
 * rather than silently comparing against zero.
 */
export function useCreateImportBatch() {
  return useMutation({
    mutationFn: async (input: { label: string; content_type: "case_law" | "legislation"; expected_file_count: number }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { data, error } = await supabase
        .from("import_batches")
        .insert({
          label: input.label,
          content_type: input.content_type,
          created_by: user.id,
          expected_file_count: input.expected_file_count,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * EXACT file-hash duplicate pre-check (Section 15) — run BEFORE the
 * expensive extraction/OCR work for a bulk item, not just after draft
 * creation (findCaseLawDuplicates/findStatuteDuplicates in
 * legal-extraction.ts still run at draft-creation time too, as a second
 * layer, for the single-import path and for the "possible same case,
 * different file" signal bulk mode also needs). This one check answers
 * only "is this the identical file, byte for byte, as something already
 * on record" — never "is this possibly the same case" (that distinction
 * matters: Section 15 explicitly warns two different scans/report
 * versions of the same case must NOT be silently treated as the same
 * file).
 */
export async function checkExactDuplicateByHash(
  contentType: "case_law" | "legislation",
  hash: string,
): Promise<{ id: string; label: string } | null> {
  if (contentType === "case_law") {
    const { data, error } = await supabase.from("case_law").select("id, case_name, citation").eq("document_hash", hash).limit(1);
    return interpretDuplicateQuery({ data, error }, (row) => ({
      id: row.id,
      label: `${row.case_name} (${row.citation})`,
    }));
  }
  const { data, error } = await supabase.from("statutes").select("id, title, code").eq("document_hash", hash).limit(1);
  return interpretDuplicateQuery({ data, error }, (row) => ({
    id: row.id,
    label: `${row.title} (${row.code})`,
  }));
}

/**
 * CANONICAL CITATION conflict pre-check — a genuinely different bug class
 * from the exact-file-hash check above, and the actual root cause of a
 * live bug found in bulk-import testing: `case_law.citation` has a unique
 * index scoped to canonical rows (`case_law_citation_canonical_unique_idx`,
 * owner_id IS NULL, migration 0035), but nothing checked it BEFORE calling
 * `create_case_law_import` — so a bulk item whose citation matched an
 * already-published canonical case (a different scan/report of the SAME
 * case — Section 9/15's explicit "possible legal record duplicate"
 * scenario, not a byte-identical file) hit the raw Postgres constraint,
 * and the generic 23505 fallback message ("That already exists.") made it
 * indistinguishable from a genuine extraction failure in the bulk queue.
 *
 * This does not decide whether the new file is "the same case" in any
 * deep sense — it only answers the narrow, mechanical question "would
 * inserting this citation as a new CANONICAL row violate the existing
 * uniqueness constraint" — so the caller can skip the doomed insert and
 * surface this as a duplicate/conflict for curator review instead of
 * letting it fail. Personal (owner_id IS NOT NULL) rows are correctly
 * excluded, matching the index's own scope.
 */
export async function checkCanonicalCitationConflict(
  citation: string,
): Promise<{ id: string; label: string } | null> {
  const trimmed = citation.trim();
  if (!trimmed) return null;
  const { data, error } = await supabase
    .from("case_law")
    .select("id, case_name, citation")
    .eq("citation", trimmed)
    .is("owner_id", null)
    .limit(1);
  return interpretDuplicateQuery({ data, error }, (row) => ({
    id: row.id,
    label: `${row.case_name} (${row.citation})`,
  }));
}

/**
 * Records a BARE import_jobs row — one with no target_case_law_id/
 * target_statute_id — for a bulk item that did NOT result in a new
 * canonical draft: an exact-file-hash duplicate, a citation conflict, or
 * a genuine processing failure. This is the core fix for "the batch
 * disappears on refresh" (Section 6/23/28): previously the ONLY way an
 * import_jobs row was ever created was via create_case_law_import/
 * create_legislation_import, which ALSO always creates a case_law/
 * statutes row — so a duplicate or failed bulk item left NO trace in the
 * database at all, and the transient in-memory queue state was the only
 * place that outcome ever existed. Every bulk outcome now gets a
 * persisted row, so `import_jobs where batch_id = X` is a complete,
 * accurate reconstruction of what happened to every file in a batch,
 * survives navigation/refresh, and is the data source for the Batch
 * Detail view.
 *
 * A direct table insert (not an RPC) is deliberate and sufficient: the
 * existing RLS policy "Admins can create import jobs" already permits
 * exactly this (`is_admin() and created_by = auth.uid()`), and no
 * companion case_law/statutes row needs to be created transactionally
 * here — that is the whole point of a "bare" job row.
 */
export async function recordBulkNonDraftJob(input: {
  batch_id: string | null;
  content_type: "case_law" | "legislation";
  status: "duplicate" | "failed";
  reason: string;
  source_id: string | null;
  originalFilename: string;
  /** The existing canonical record this item collided with, when known (Section 8: a duplicate row should link to the existing record). */
  duplicateOfId?: string | null;
  /** When set, UPDATE this existing queued/extracting row instead of inserting a second job. */
  jobId?: string | null;
  retryCount?: number;
  outcomeFlag?: "rejected" | "cancelled" | null;
}): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const extracted_metadata = {
    _originalFilename: input.originalFilename,
    _duplicateOfId: input.duplicateOfId ?? null,
    _rejectedBeforeProcessing: input.outcomeFlag === "rejected",
    _cancelled: input.outcomeFlag === "cancelled",
  } as unknown as Json;

  if (input.jobId) {
    const { error } = await supabase
      .from("import_jobs")
      .update({
        status: input.status,
        error_summary: input.status === "failed" ? input.reason : null,
        duplicate_warning: input.status === "duplicate" ? input.reason : null,
        completed_at: new Date().toISOString(),
        retry_count: input.retryCount ?? undefined,
        extracted_metadata,
      })
      .eq("id", input.jobId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("import_jobs").insert({
    batch_id: input.batch_id,
    content_type: input.content_type,
    source_id: input.source_id,
    status: input.status,
    error_summary: input.status === "failed" ? input.reason : null,
    duplicate_warning: input.status === "duplicate" ? input.reason : null,
    created_by: user.id,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    retry_count: input.retryCount ?? 0,
    extracted_metadata,
  });
  if (error) throw error;
}

export async function insertQueuedBulkJobs(input: {
  items: { queueId: string; originalFilename: string }[];
  batch_id: string | null;
  content_type: "case_law" | "legislation";
  source_id: string | null;
}): Promise<Record<string, string>> {
  if (input.items.length === 0) return {};
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const rows = input.items.map((item) => ({
    batch_id: input.batch_id,
    content_type: input.content_type,
    source_id: input.source_id,
    status: "queued" as const,
    created_by: user.id,
    started_at: null,
    completed_at: null,
    extracted_metadata: { _originalFilename: item.originalFilename, _queueId: item.queueId } as unknown as Json,
  }));
  const { data, error } = await supabase.from("import_jobs").insert(rows).select("id, extracted_metadata");
  if (error) throw error;
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    const meta = row.extracted_metadata as { _queueId?: string } | null;
    if (meta?._queueId && row.id) map[meta._queueId] = row.id;
  }
  return map;
}

export async function markBulkJobExtracting(jobId: string, retryCount?: number): Promise<void> {
  const { error } = await supabase
    .from("import_jobs")
    .update({
      status: "extracting",
      started_at: new Date().toISOString(),
      completed_at: null,
      error_summary: null,
      ...(typeof retryCount === "number" ? { retry_count: retryCount } : {}),
    })
    .eq("id", jobId);
  if (error) throw error;
}

export async function markBulkJobsCancelled(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  const { error } = await supabase
    .from("import_jobs")
    .update({
      status: "failed",
      error_summary: "Cancelled before this file finished processing.",
      completed_at: new Date().toISOString(),
      extracted_metadata: { _cancelled: true } as unknown as Json,
    })
    .in("id", jobIds);
  if (error) throw error;
}

/** Copy the RPC-created draft job onto the existing queued row, then delete the extra RPC row so batch counts stay honest. */
export async function adoptRpcImportJob(queuedJobId: string, rpcJobId: string): Promise<void> {
  if (queuedJobId === rpcJobId) return;
  const { data: rpc, error: readError } = await supabase.from("import_jobs").select("*").eq("id", rpcJobId).single();
  if (readError) throw readError;
  const { data: queued } = await supabase.from("import_jobs").select("extracted_metadata, retry_count").eq("id", queuedJobId).single();
  const queuedMeta =
    queued?.extracted_metadata && typeof queued.extracted_metadata === "object"
      ? (queued.extracted_metadata as Record<string, unknown>)
      : {};
  const rpcMeta =
    rpc.extracted_metadata && typeof rpc.extracted_metadata === "object"
      ? (rpc.extracted_metadata as Record<string, unknown>)
      : {};
  const { error: updateError } = await supabase
    .from("import_jobs")
    .update({
      status: rpc.status,
      target_case_law_id: rpc.target_case_law_id,
      target_statute_id: rpc.target_statute_id,
      extracted_text: rpc.extracted_text,
      extracted_metadata: { ...queuedMeta, ...rpcMeta } as unknown as Json,
      proposed_tags: rpc.proposed_tags,
      duplicate_warning: rpc.duplicate_warning,
      error_summary: rpc.error_summary,
      uploaded_document_id: rpc.uploaded_document_id,
      completed_at: rpc.completed_at ?? new Date().toISOString(),
      started_at: rpc.started_at,
      retry_count: queued?.retry_count ?? 0,
    })
    .eq("id", queuedJobId);
  if (updateError) throw updateError;
  if (rpc.target_case_law_id) {
    const { error: linkError } = await supabase
      .from("case_law")
      .update({ import_job_id: queuedJobId })
      .eq("id", rpc.target_case_law_id);
    if (linkError) throw linkError;
  }
  const { error: deleteError } = await supabase.from("import_jobs").delete().eq("id", rpcJobId);
  if (deleteError) throw deleteError;
}
export async function recordBulkRejectedJobs(
  items: { batch_id: string | null; content_type: "case_law" | "legislation"; reason: string; originalFilename: string }[],
): Promise<void> {
  if (items.length === 0) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const rows = items.map((item) => ({
    batch_id: item.batch_id,
    content_type: item.content_type,
    source_id: null,
    status: "failed" as const,
    error_summary: item.reason,
    duplicate_warning: null,
    created_by: user.id,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    extracted_metadata: { _originalFilename: item.originalFilename, _rejectedBeforeProcessing: true } as unknown as Json,
  }));
  const { error } = await supabase.from("import_jobs").insert(rows);
  if (error) throw error;
}

/** Reads the filename recorded on a bare (non-draft-creating) job row — see recordBulkNonDraftJob. `null` for a normal draft-creating job (its filename lives on the linked case_law/statutes row instead, via original_filename). */
export function readBareJobFilename(extractedMetadata: unknown): string | null {
  if (!extractedMetadata || typeof extractedMetadata !== "object") return null;
  const v = (extractedMetadata as Record<string, unknown>)._originalFilename;
  return typeof v === "string" ? v : null;
}

/** Reads the existing record id a "duplicate" bare job row conflicted with — see recordBulkNonDraftJob. */
export function readDuplicateOfId(extractedMetadata: unknown): string | null {
  if (!extractedMetadata || typeof extractedMetadata !== "object") return null;
  const v = (extractedMetadata as Record<string, unknown>)._duplicateOfId;
  return typeof v === "string" ? v : null;
}

export function readRejectedBeforeProcessing(extractedMetadata: unknown): boolean {
  if (!extractedMetadata || typeof extractedMetadata !== "object") return false;
  return (extractedMetadata as Record<string, unknown>)._rejectedBeforeProcessing === true;
}

export function readCancelledJob(extractedMetadata: unknown): boolean {
  if (!extractedMetadata || typeof extractedMetadata !== "object") return false;
  return (extractedMetadata as Record<string, unknown>)._cancelled === true;
}

export const IN_FLIGHT_IMPORT_JOB_STATUSES = new Set(["queued", "fetching", "extracting", "structuring"]);

export function isInFlightImportJobStatus(status: string): boolean {
  return IN_FLIGHT_IMPORT_JOB_STATUSES.has(status);
}

export interface ImportBatchSummary {
  id: string;
  label: string;
  content_type: string;
  created_at: string;
  counts: Record<string, number>;
  total: number;
  /** How many files the curator originally selected (0064) — null for batches created before this was tracked. See `isLegacyIncomplete`/`isFullyAccounted` below for how to interpret it. */
  expected_file_count: number | null;
  /** True when this batch predates the persistent bare-job-row architecture (expected_file_count was never recorded) — its per-file history cannot be reconstructed and the UI must say so rather than imply completeness it can't back up. */
  isLegacyIncomplete: boolean;
  /** True when every originally-selected file has a matching persisted outcome — the batch accounting invariant (Section 5) holds for this batch. False while a batch is still processing, or (should never happen going forward) if an outcome failed to persist. */
  isFullyAccounted: boolean;
}

/**
 * Persistent batch HISTORY list (Section 6/21: "Legal Library → Import
 * Batches... date / source / count / status summary"). Status counts are
 * computed by aggregating import_jobs.status client-side (no redundant
 * denormalized count that could drift out of sync with the real per-job
 * rows — Section 30). `expected_file_count` (0064) IS a stored column,
 * deliberately: unlike the status counts, "how many files did the curator
 * originally select" is not derivable from import_jobs after the fact if
 * some outcomes never got persisted (exactly the legacy-batch problem this
 * column exists to make legible instead of silently confusing).
 */
export function useImportBatches() {
  return useQuery({
    queryKey: [...importJobKeys.all, "batches"] as const,
    queryFn: async () => {
      const { data: batches, error: batchError } = await supabase
        .from("import_batches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (batchError) throw batchError;
      if (!batches || batches.length === 0) return [] as ImportBatchSummary[];

      const ids = batches.map((b) => b.id);
      const { data: jobs, error: jobsError } = await supabase
        .from("import_jobs")
        .select("batch_id, status")
        .in("batch_id", ids);
      if (jobsError) throw jobsError;

      return batches.map((b): ImportBatchSummary => {
        const counts: Record<string, number> = {};
        let total = 0;
        for (const j of jobs ?? []) {
          if (j.batch_id !== b.id) continue;
          counts[j.status] = (counts[j.status] ?? 0) + 1;
          total += 1;
        }
        const expected = (b as { expected_file_count: number | null }).expected_file_count;
        return {
          id: b.id,
          label: b.label,
          content_type: b.content_type,
          created_at: b.created_at,
          counts,
          total,
          expected_file_count: expected,
          isLegacyIncomplete: expected === null,
          isFullyAccounted: expected !== null && total >= expected,
        };
      });
    },
  });
}

export interface ImportBatchJobRow {
  id: string;
  status: string;
  error_summary: string | null;
  duplicate_warning: string | null;
  target_case_law_id: string | null;
  target_statute_id: string | null;
  extracted_metadata: unknown;
  created_at: string;
  /** Resolved display fields — filename/case name/citation — from whichever source actually has them (the linked draft, or the bare-job metadata for a duplicate/failed outcome). */
  filename: string;
  displayName: string | null;
  reviewStatus: string | null;
  /** null for a bare job row with no linked draft (nothing to grade yet). */
  contentQualityStatus: string | null;
}

/**
 * Persistent Batch Detail (Section 7): every import_job for one batch,
 * enriched with a resolved filename/display name regardless of whether it
 * resulted in a draft (target_case_law_id set) or not (bare job row).
 * This is what makes "leave the page mid-batch, come back later, open
 * the same batch" (Section 34, product principle) actually work — the
 * whole view is a query over persisted rows, not component state.
 */
export function useImportBatchDetail(batchId: string | null) {
  return useQuery({
    queryKey: [...importJobKeys.all, "batch-detail", batchId] as const,
    enabled: !!batchId,
    queryFn: async () => {
      const { data: batch, error: batchError } = await supabase
        .from("import_batches")
        .select("*")
        .eq("id", batchId as string)
        .single();
      if (batchError) throw batchError;

      const { data: jobs, error: jobsError } = await supabase
        .from("import_jobs")
        .select("*")
        .eq("batch_id", batchId as string)
        .order("created_at", { ascending: true });
      if (jobsError) throw jobsError;

      const caseLawIds = (jobs ?? []).map((j) => j.target_case_law_id).filter((id): id is string => !!id);
      const statuteIds = (jobs ?? []).map((j) => j.target_statute_id).filter((id): id is string => !!id);

      const [caseLawRows, statuteRows] = await Promise.all([
        caseLawIds.length > 0
          ? supabase
              .from("case_law")
              .select("id, case_name, citation, original_filename, review_status, content_quality_status")
              .in("id", caseLawIds)
          : Promise.resolve({
              data: [] as {
                id: string;
                case_name: string;
                citation: string;
                original_filename: string | null;
                review_status: string;
                content_quality_status: string;
              }[],
            }),
        statuteIds.length > 0
          ? supabase
              .from("statutes")
              .select("id, title, code, original_filename, review_status, content_quality_status")
              .in("id", statuteIds)
          : Promise.resolve({
              data: [] as {
                id: string;
                title: string;
                code: string;
                original_filename: string | null;
                review_status: string;
                content_quality_status: string;
              }[],
            }),
      ]);

      const caseLawById = new Map((caseLawRows.data ?? []).map((r) => [r.id, r]));
      const statuteById = new Map((statuteRows.data ?? []).map((r) => [r.id, r]));

      const rows: ImportBatchJobRow[] = (jobs ?? []).map((j) => {
        if (j.target_case_law_id) {
          const cl = caseLawById.get(j.target_case_law_id);
          return {
            id: j.id,
            status: j.status,
            error_summary: j.error_summary,
            duplicate_warning: j.duplicate_warning,
            target_case_law_id: j.target_case_law_id,
            target_statute_id: null,
            extracted_metadata: j.extracted_metadata,
            created_at: j.created_at,
            filename: cl?.original_filename ?? "(unknown file)",
            displayName: cl ? `${cl.case_name} — ${cl.citation}` : null,
            reviewStatus: cl?.review_status ?? null,
            contentQualityStatus: cl?.content_quality_status ?? null,
          };
        }
        if (j.target_statute_id) {
          const st = statuteById.get(j.target_statute_id);
          return {
            id: j.id,
            status: j.status,
            error_summary: j.error_summary,
            duplicate_warning: j.duplicate_warning,
            target_case_law_id: null,
            target_statute_id: j.target_statute_id,
            extracted_metadata: j.extracted_metadata,
            created_at: j.created_at,
            filename: st?.original_filename ?? "(unknown file)",
            displayName: st ? `${st.title} (${st.code})` : null,
            reviewStatus: st?.review_status ?? null,
            contentQualityStatus: st?.content_quality_status ?? null,
          };
        }
        // Bare job row (duplicate/failed/rejected) — no linked draft.
        return {
          id: j.id,
          status: j.status,
          error_summary: j.error_summary,
          duplicate_warning: j.duplicate_warning,
          target_case_law_id: null,
          target_statute_id: null,
          extracted_metadata: j.extracted_metadata,
          contentQualityStatus: null,
          created_at: j.created_at,
          filename: readBareJobFilename(j.extracted_metadata) ?? "(unknown file)",
          displayName: null,
          reviewStatus: null,
        };
      });

      const expected = (batch as { expected_file_count: number | null }).expected_file_count;
      const hasInterrupted = (jobs ?? []).some((j) => isInFlightImportJobStatus(j.status));
      return {
        batch,
        rows,
        expected_file_count: expected,
        isLegacyIncomplete: expected === null,
        isFullyAccounted: expected !== null && rows.length >= expected && !hasInterrupted,
        interruptedCount: (jobs ?? []).filter((j) => isInFlightImportJobStatus(j.status)).length,
      };
    },
  });
}

export function useImportJobs() {
  return useQuery({
    queryKey: importJobKeys.all,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateImportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      values,
    }: {
      id: string;
      values: Partial<{
        status: string;
        error_summary: string | null;
        retry_count: number;
        completed_at: string | null;
        uploaded_document_id: string | null;
      }>;
    }) => {
      const { error } = await supabase.from("import_jobs").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: importJobKeys.all });
    },
  });
}

export function useDeleteImportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("import_jobs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Import job removed.");
      void queryClient.invalidateQueries({ queryKey: importJobKeys.all });
    },
  });
}

interface IngestCaseLawInput {
  text: string;
  file: File | null;
  source_url: string | null;
  source_id: string | null;
  original_filename: string | null;
  batch_id: string | null;
  /** Extraction provenance for `text` above — defaults to an empty/"pending" envelope when the caller doesn't have one (e.g. no file was ever selected). Never used to gate submission here; the Review Queue/publication validation are the gates. */
  extractionEnvelope?: ExtractionEnvelope;
  /** Curator-supplied minimum fields; extraction proposes the rest but never overwrites what the curator explicitly typed. */
  known: {
    case_name?: string;
    citation: string;
    court: string;
    jurisdiction: string;
    court_id?: string | null;
    jurisdiction_id?: string | null;
    /** The type of matter this case relates to (legal_case_categories, 0073) — curator-selected, never inferred. */
    category_id?: string | null;
    /** Curator-confirmed decision date — takes priority over the deterministic extraction guess when supplied. */
    decided_date?: string | null;
    /**
     * Provenance for `case_name` above, when the CALLER already resolved
     * it (bulk mode) rather than leaving it for this hook's own
     * `extraction.caseNameConfidence === "high"` fallback below (Section
     * 16/17: filename-derived metadata is SECONDARY support and must be
     * recorded as such, never presented as if it came from the document
     * text). `"curator"` covers the single-import form, where a
     * non-empty `case_name` was typed by a human. Left undefined when the
     * caller has no opinion — this hook then falls back to its own
     * document-text-confidence-based label.
     */
    case_name_source?: "document" | "filename" | "curator";
  };
  /** When bulk import already inserted a queued job row, the RPC-created job is folded onto this id. */
  existingJobId?: string | null;
}

/**
 * Runs deterministic extraction + duplicate detection over supplied Case
 * Law text, then creates the canonical draft row + import_jobs row +
 * bidirectional link atomically via `create_case_law_import` (0058).
 * Uploads the original file (if supplied) to the secure documents Storage
 * architecture as a follow-up step. Returns the new case_law id so the
 * caller can navigate straight to the Review Queue detail for that item.
 */
export function useIngestCaseLaw() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: IngestCaseLawInput) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      // Defensive sanitization boundary right before database submission
      // (Phase 5) — catches BOTH the machine-extraction path (which
      // should already be sanitized by extraction-pipeline.ts, but this
      // hook must not simply trust that) and curator-typed/pasted text
      // (a genuinely different corruption path — clipboard sources can
      // carry unpaired surrogates that a PDF parser never would).
      const text = normalizeWhitespace(sanitizeExtractedText(input.text).text);
      const envelope = input.extractionEnvelope ?? emptyExtractionEnvelope();
      // Metadata extraction only ever runs over text that has already
      // passed the quality gate (envelope carries no text at all for
      // "requires_ocr"/"failed"/"pending") or was manually supplied
      // (method "manual_paste"/"txt_file", or no envelope at all --
      // treated as trusted curator input, same as before this pass).
      const usableForMetadata = envelope.status !== "requires_ocr" && envelope.status !== "failed" && !!text;
      // Phase 3 (Task 4): text quality and metadata confidence are
      // separate gates. `usableForMetadata` answers "was there clean
      // enough TEXT to even attempt metadata extraction" — but a
      // case-name PROPOSAL is only trusted enough to silently become the
      // canonical p_case_name below when caseNameConfidence is "high". A
      // "low"/"none" confidence proposal is still surfaced (via
      // _extraction.metadataConfidence, read by the Review Queue) but
      // NEVER substituted for a curator-confirmed name — see the
      // p_case_name fallback below, which only ever falls through to the
      // proposal on "high" confidence, otherwise to the honest
      // placeholder that publication validation blocks on.
      // Page-aware prioritization (Section 34): normalize each page's text
      // the same way the flat `text` above was normalized, so the head
      // window built from pages is consistent with the rest of this flow.
      const normalizedPages = envelope.pages.map((p) => ({ pageNumber: p.pageNumber, text: normalizeWhitespace(p.text) }));
      const extraction = usableForMetadata
        ? extractCaseLawMetadataWithConfidence(text, normalizedPages, { filename: input.original_filename })
        : { fields: {}, caseNameConfidence: "none" as const, authoritiesCited: [] as string[], citationSource: "none" as const };
      const proposed = extraction.fields;
      const scoredTags = usableForMetadata ? proposeTagsScored(text) : [];
      const tags = scoredTags.map((t) => t.name);
      const tagProposals = toTagProposalDetails(scoredTags);
      const hash = input.file ? await sha256File(input.file) : text ? await sha256Text(text) : null;

      const duplicates = hash || text
        ? await findCaseLawDuplicates({
            documentHash: hash ?? undefined,
            neutralCitation: proposed.neutral_citation,
            caseName: input.known.case_name ?? proposed.case_name,
            court: input.known.court,
          })
        : [];

      const writtenCaseName =
        input.known.case_name ??
        (shouldProposeCaseName(extraction.caseNameConfidence, envelope.ocrUsed) ? proposed.case_name : undefined) ??
        "Untitled (pending review)";
      const writtenCitation = input.known.citation;
      const writtenDate = input.known.decided_date ?? proposed.decided_date_guess ?? null;

      const { data, error } = await supabase.rpc("create_case_law_import", {
        p_case_name: writtenCaseName,
        p_citation: writtenCitation,
        p_court: input.known.court,
        p_jurisdiction: input.known.jurisdiction,
        p_court_id: input.known.court_id ?? undefined,
        p_jurisdiction_id: input.known.jurisdiction_id ?? undefined,
        p_category_id: input.known.category_id ?? undefined,
        p_neutral_citation: proposed.neutral_citation ?? undefined,
        p_reported_citation: proposed.reported_citation ?? undefined,
        p_decided_date: writtenDate ?? undefined,
        p_full_text: text || undefined,
        p_source_url: input.source_url ?? undefined,
        p_source_id: input.source_id ?? undefined,
        p_original_filename: input.original_filename ?? undefined,
        p_document_hash: hash ?? undefined,
        p_batch_id: input.batch_id ?? undefined,
        p_extracted_metadata: {
          ...proposed,
          tag_proposals: tagProposals,
          authoritiesCited: extraction.authoritiesCited,
          citationSource: extraction.citationSource,
          _extraction: envelope,
          _metadataConfidence: {
            caseName: extraction.caseNameConfidence,
            caseNameSource:
              input.known.case_name_source ??
              (input.known.case_name ? "curator" : shouldProposeCaseName(extraction.caseNameConfidence, envelope.ocrUsed) ? "document" : undefined),
          },
          _lastMachineProposal: {
            case_name: writtenCaseName,
            citation: writtenCitation,
            court_id: input.known.court_id ?? null,
            jurisdiction_id: input.known.jurisdiction_id ?? null,
            decided_date: writtenDate ?? "",
            full_text: text || "",
          },
        } as unknown as Json,
        p_proposed_tags: tags,
        p_duplicate_warning:
          duplicates.length > 0
            ? duplicates.map((d) => `${d.strength}: ${d.reason} (${d.existingLabel})`).join(" | ")
            : undefined,
      });
      if (error) throw error;
      const row = data?.[0];
      if (!row) throw new Error("create_case_law_import did not return an id.");

      if (input.existingJobId) {
        try {
          await adoptRpcImportJob(input.existingJobId, row.import_job_id as string);
          row.import_job_id = input.existingJobId;
        } catch (e) {
          console.error("Could not fold the draft job onto the queued row:", e);
        }
      }

      let uploadError: string | null = null;
      if (input.file) {
        try {
          const doc = await uploadDocumentToEntity("case_law", row.case_law_id, input.file);
          const { error: linkError } = await supabase
            .from("import_jobs")
            .update({ uploaded_document_id: doc.id })
            .eq("id", row.import_job_id);
          if (linkError) throw linkError;
        } catch (e) {
          uploadError = getErrorMessage(e);
        }
      }

      return {
        caseLawId: row.case_law_id as string,
        duplicates,
        proposedTags: tags,
        uploadError,
      };
    },
    onSuccess: (result) => {
      if (result.uploadError) {
        toast.warning(
          `Draft created, but the original file could not be uploaded: ${result.uploadError}. Attach it again from the Review Queue.`,
        );
      } else if (result.duplicates.length > 0) {
        toast.warning(
          `Draft created with ${result.duplicates.length} possible duplicate warning(s). Review before publishing.`,
        );
      } else {
        toast.success("Draft created and sent to Review Queue.");
      }
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.reviewQueue });
      void queryClient.invalidateQueries({ queryKey: importJobKeys.all });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

interface IngestLegislationInput {
  text: string;
  file: File | null;
  source_url: string | null;
  source_id: string | null;
  original_filename: string | null;
  batch_id: string | null;
  /** Same extraction provenance as Case Law (Phase 12: Legislation shares the same ingestion architecture, not a Case-Law-only dead end). */
  extractionEnvelope?: ExtractionEnvelope;
  known: {
    code: string;
    title: string;
    jurisdiction: string;
    short_title?: string;
    jurisdiction_id?: string | null;
  };
}

export function useIngestLegislation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: IngestLegislationInput) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const text = normalizeWhitespace(sanitizeExtractedText(input.text).text);
      const envelope = input.extractionEnvelope ?? emptyExtractionEnvelope();
      const usableForMetadata = envelope.status !== "requires_ocr" && envelope.status !== "failed" && !!text;
      const provisions = usableForMetadata ? extractLegislationHierarchy(text) : [];
      const scoredTags = usableForMetadata ? proposeTagsScored(text) : [];
      const tags = scoredTags.map((t) => t.name);
      const tagProposals = toTagProposalDetails(scoredTags);
      const hash = input.file ? await sha256File(input.file) : text ? await sha256Text(text) : null;

      const duplicates = hash || text
        ? await findStatuteDuplicates({
            documentHash: hash ?? undefined,
            title: input.known.title,
            jurisdiction: input.known.jurisdiction,
          })
        : [];

      const { data, error } = await supabase.rpc("create_legislation_import", {
        p_code: input.known.code,
        p_title: input.known.title,
        p_jurisdiction: input.known.jurisdiction,
        p_jurisdiction_id: input.known.jurisdiction_id ?? undefined,
        p_short_title: input.known.short_title ?? undefined,
        p_full_text: text || undefined,
        p_source_url: input.source_url ?? undefined,
        p_source_id: input.source_id ?? undefined,
        p_original_filename: input.original_filename ?? undefined,
        p_document_hash: hash ?? undefined,
        p_batch_id: input.batch_id ?? undefined,
        p_extracted_metadata: {
          provisionCount: provisions.length,
          tag_proposals: tagProposals,
          _extraction: envelope,
        } as unknown as Json,
        p_proposed_tags: tags,
        p_duplicate_warning:
          duplicates.length > 0
            ? duplicates.map((d) => `${d.strength}: ${d.reason} (${d.existingLabel})`).join(" | ")
            : undefined,
        p_provisions: provisions.map((p) => ({
          level: p.level,
          number: p.number,
          heading: p.heading,
          body_text: p.body_text,
          sort_order: p.sort_order,
        })) as unknown as Json,
      });
      if (error) throw error;
      const row = data?.[0];
      if (!row) throw new Error("create_legislation_import did not return an id.");

      let uploadError: string | null = null;
      if (input.file) {
        try {
          const doc = await uploadDocumentToEntity("statute", row.statute_id, input.file);
          const { error: linkError } = await supabase
            .from("import_jobs")
            .update({ uploaded_document_id: doc.id })
            .eq("id", row.import_job_id);
          if (linkError) throw linkError;
        } catch (e) {
          uploadError = getErrorMessage(e);
        }
      }

      return {
        statuteId: row.statute_id as string,
        duplicates,
        proposedTags: tags,
        provisionCount: row.provision_count as number,
        uploadError,
      };
    },
    onSuccess: (result) => {
      if (result.uploadError) {
        toast.warning(
          `Draft created (${result.provisionCount} provisions), but the original file could not be uploaded: ${result.uploadError}. Attach it again from the Review Queue.`,
        );
      } else if (result.duplicates.length > 0) {
        toast.warning(
          `Draft created (${result.provisionCount} provisions) with ${result.duplicates.length} possible duplicate warning(s). Review before publishing.`,
        );
      } else {
        toast.success(`Draft created with ${result.provisionCount} provisions and sent to Review Queue.`);
      }
      void queryClient.invalidateQueries({ queryKey: legislationKeys.reviewQueue });
      void queryClient.invalidateQueries({ queryKey: importJobKeys.all });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

export interface ReprocessCaseLawInput {
  caseLawId: string;
  importJobId: string | null;
  uploadedDocumentId: string;
  originalFilename: string | null;
  current: MachineProposal;
  extractedMetadata: unknown;
  courts: CourtLike[];
  jurisdictions: { id: string; name: string }[];
  onProgress?: (page: number, total: number) => void;
  maxOcrPages?: number;
}

/**
 * Re-run extraction from the stored original PDF. Updates machine
 * proposals and full_text; does not auto-publish; does not overwrite
 * curator-typed fields that differ from the last machine snapshot.
 */
export function useReprocessCaseLawExtraction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReprocessCaseLawInput) => {
      const file = await downloadDocumentAsFile(input.uploadedDocumentId);
      const envelope = await ingestDocument(file, {
        onOcrProgress: input.onProgress
          ? (info) => input.onProgress?.(info.page, info.total)
          : undefined,
        maxOcrPages: input.maxOcrPages,
      });
      const text = normalizeWhitespace(sanitizeExtractedText(envelope.text).text);
      const usable = envelope.status !== "requires_ocr" && envelope.status !== "failed" && !!text;
      const normalizedPages = envelope.pages.map((p) => ({
        pageNumber: p.pageNumber,
        text: normalizeWhitespace(p.text),
      }));
      const filename = input.originalFilename ?? file.name;
      const extraction = usable
        ? extractCaseLawMetadataWithConfidence(text, normalizedPages, { filename })
        : {
            fields: {},
            caseNameConfidence: "none" as const,
            authoritiesCited: [] as string[],
            citationSource: "none" as const,
          };
      const proposed = extraction.fields;
      const fromFilename = extractCaseNameFromFilename(filename);
      const nextCitation =
        fromFilename?.reported_citation ??
        fromFilename?.neutral_citation ??
        proposed.reported_citation ??
        proposed.neutral_citation ??
        "";
      let nextName = "";
      if (shouldProposeCaseName(extraction.caseNameConfidence, envelope.ocrUsed) && proposed.case_name) {
        nextName = proposed.case_name;
      } else if (fromFilename?.case_name && !envelope.ocrUsed) {
        nextName = fromFilename.case_name;
      }
      let nextCourtId: string | null = null;
      let nextJurisdictionId: string | null = null;
      if (usable) {
        const matched = matchCanonicalCourtScored(envelope.text, input.courts);
        if (matched && matched.confidence !== "low") {
          nextCourtId = matched.court.id;
          nextJurisdictionId = matched.court.jurisdiction_id ?? null;
        }
      }
      const next: MachineProposal = {
        case_name: nextName || "Untitled (pending review)",
        citation: nextCitation,
        court_id: nextCourtId,
        jurisdiction_id: nextJurisdictionId,
        decided_date: proposed.decided_date_guess ?? "",
        full_text: envelope.status === "requires_ocr" || envelope.status === "failed" ? "" : text,
      };
      const last = readLastMachineProposal(input.extractedMetadata);
      const merged = mergeReprocessFields(input.current, next, last);
      const courtName = input.courts.find((c) => c.id === merged.court_id)?.canonical_name ?? "Court";
      const jurisdictionName =
        input.jurisdictions.find((j) => j.id === merged.jurisdiction_id)?.name ?? "Jurisdiction";

      const { error: caseError } = await supabase
        .from("case_law")
        .update({
          case_name: merged.case_name,
          citation: merged.citation,
          decided_date: merged.decided_date || null,
          court_id: merged.court_id,
          jurisdiction_id: merged.jurisdiction_id,
          court: courtName,
          jurisdiction: jurisdictionName,
          full_text: merged.full_text || null,
          review_status: "needs_review",
        })
        .eq("id", input.caseLawId);
      if (caseError) throw caseError;

      const prevMeta =
        input.extractedMetadata && typeof input.extractedMetadata === "object"
          ? (input.extractedMetadata as Record<string, unknown>)
          : {};
      const nextMeta = {
        ...prevMeta,
        ...proposed,
        authoritiesCited: extraction.authoritiesCited,
        citationSource: extraction.citationSource,
        _extraction: envelope,
        _metadataConfidence: {
          caseName: extraction.caseNameConfidence,
          caseNameSource: shouldProposeCaseName(extraction.caseNameConfidence, envelope.ocrUsed)
            ? "document"
            : fromFilename?.case_name
              ? "filename"
              : undefined,
        },
        _lastMachineProposal: next,
      } as unknown as Json;

      if (input.importJobId) {
        const { error: jobError } = await supabase
          .from("import_jobs")
          .update({
            extracted_metadata: nextMeta,
            extracted_text: next.full_text || null,
            status: "needs_review",
          })
          .eq("id", input.importJobId);
        if (jobError) throw jobError;
      }

      return { envelope, merged, next };
    },
    onSuccess: (_result, variables) => {
      toast.success("Extraction re-ran from the stored original. This draft was not published.");
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.reviewQueue });
      void queryClient.invalidateQueries({ queryKey: caseLawKeys.detail(variables.caseLawId) });
      void queryClient.invalidateQueries({ queryKey: importJobKeys.all });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}

export interface ReassessStatuteInput {
  statuteId: string;
  importJobId: string | null;
  /** Text to assess — either the currently-stored `full_text` unchanged, or a curator-pasted replacement. Never re-fetched from a source URL (Legislation has no "re-run from original file" path — see StatuteReviewCard). */
  fullText: string;
  extractedMetadata: unknown;
  current: {
    short_title: string | null;
    act_number: string | null;
    enactment_year: number | null;
    instrument_type: string | null;
    chapter_number: string | null;
  };
}

/**
 * Re-assesses whatever text is currently on record for a Legislation
 * draft against the real quality gate + the legislation metadata
 * extractor, and writes the result back. Never re-fetches a source PDF —
 * "re-check," not "re-run extraction," since nothing is re-extracted (see
 * StatuteReviewCard's button label). Only backfills the optional metadata
 * fields that are still empty — never overwrites a curator-entered value.
 */
export function useReassessStatuteExtraction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReassessStatuteInput) => {
      const text = normalizeWhitespace(sanitizeExtractedText(input.fullText).text);
      const assessment = assessExtractionQuality(text);
      const status: ExtractionEnvelope["status"] = !text
        ? "pending"
        : !assessment.passed
          ? "failed"
          : assessment.score >= CLEAN_SCORE_THRESHOLD
            ? "extracted"
            : "low_quality";
      const envelope: ExtractionEnvelope = {
        status,
        method: "manual_paste",
        text: status === "failed" ? "" : text,
        charCount: status === "failed" ? 0 : text.length,
        qualityScore: text ? assessment.score : null,
        characterQuality: text ? assessment.characterQuality : null,
        structuralQuality: text ? assessment.structuralQuality : null,
        warnings: assessment.warnings,
        ocrUsed: false,
        requiresReview: true,
        pages: [],
        pageCount: 0,
        unreadableReason: null,
        hardFailReason: assessment.hardFailReason ?? null,
      };
      const contentQualityStatus = deriveContentQualityStatus(envelope);
      const extracted = text ? extractLegislationMetadataWithConfidence(text) : null;

      const statuteUpdate: TablesUpdate<"statutes"> = {
        full_text: text || null,
        content_quality_status: contentQualityStatus,
        review_status: "needs_review",
      };
      if (!input.current.short_title && extracted?.fields.short_title) {
        statuteUpdate.short_title = extracted.fields.short_title;
      }
      if (!input.current.act_number && extracted?.fields.act_number) {
        statuteUpdate.act_number = extracted.fields.act_number;
      }
      if (!input.current.enactment_year && extracted?.fields.enactment_year) {
        statuteUpdate.enactment_year = extracted.fields.enactment_year;
      }
      if (!input.current.instrument_type && extracted?.fields.instrument_type) {
        statuteUpdate.instrument_type = extracted.fields.instrument_type;
      }
      if (!input.current.chapter_number && extracted?.fields.chapter_number) {
        statuteUpdate.chapter_number = extracted.fields.chapter_number;
      }

      const { error: statuteError } = await supabase.from("statutes").update(statuteUpdate).eq("id", input.statuteId);
      if (statuteError) throw statuteError;

      if (input.importJobId) {
        const prevMeta =
          input.extractedMetadata && typeof input.extractedMetadata === "object"
            ? (input.extractedMetadata as Record<string, unknown>)
            : {};
        const nextMeta = {
          ...prevMeta,
          _extraction: envelope,
          _legislationMetadataProposal: extracted,
        } as unknown as Json;
        const { error: jobError } = await supabase
          .from("import_jobs")
          .update({ extracted_metadata: nextMeta, extracted_text: text || null, status: "needs_review" })
          .eq("id", input.importJobId);
        if (jobError) throw jobError;
      }

      return { envelope, contentQualityStatus };
    },
    onSuccess: (_result, variables) => {
      toast.success("Extraction quality re-checked. This draft was not published.");
      void queryClient.invalidateQueries({ queryKey: legislationKeys.reviewQueue });
      void queryClient.invalidateQueries({ queryKey: legislationKeys.detail(variables.statuteId) });
      void queryClient.invalidateQueries({ queryKey: importJobKeys.all });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}
