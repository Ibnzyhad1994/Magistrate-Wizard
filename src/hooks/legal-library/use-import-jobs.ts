import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";
import {
  extractCaseLawMetadataWithConfidence,
  extractLegislationHierarchy,
  findCaseLawDuplicates,
  findStatuteDuplicates,
  normalizeWhitespace,
  proposeTags,
  sha256File,
  sha256Text,
} from "@/lib/legal-extraction";
import { sanitizeExtractedText } from "@/lib/text-sanitize";
import { emptyExtractionEnvelope, type ExtractionEnvelope } from "@/lib/extraction-pipeline";
import { uploadDocumentToEntity } from "@/hooks/use-documents";
import { caseLawKeys } from "@/hooks/case-law/use-case-law";
import { legislationKeys } from "@/hooks/legislation/use-legislation";
import type { Json } from "@/types/database.types";

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
 */
export function useCreateImportBatch() {
  return useMutation({
    mutationFn: async (input: { label: string; content_type: "case_law" | "legislation" }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { data, error } = await supabase
        .from("import_batches")
        .insert({ label: input.label, content_type: input.content_type, created_by: user.id })
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
    const { data } = await supabase.from("case_law").select("id, case_name, citation").eq("document_hash", hash).limit(1);
    const row = data?.[0];
    return row ? { id: row.id, label: `${row.case_name} (${row.citation})` } : null;
  }
  const { data } = await supabase.from("statutes").select("id, title, code").eq("document_hash", hash).limit(1);
  const row = data?.[0];
  return row ? { id: row.id, label: `${row.title} (${row.code})` } : null;
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
  const { data } = await supabase
    .from("case_law")
    .select("id, case_name, citation")
    .eq("citation", trimmed)
    .is("owner_id", null)
    .limit(1);
  const row = data?.[0];
  return row ? { id: row.id, label: `${row.case_name} (${row.citation})` } : null;
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
}): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

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
    // No case_law/statutes row exists for this outcome, so the original
    // filename and (for duplicates) the conflicting record's id are the
    // only way Batch Detail can identify which file this row is about —
    // stored under extracted_metadata (already a flexible jsonb used for
    // exactly this kind of provenance elsewhere in this file), not a new
    // column, since this is the only place these two fields are needed.
    extracted_metadata: {
      _originalFilename: input.originalFilename,
      _duplicateOfId: input.duplicateOfId ?? null,
    } as unknown as Json,
  });
  if (error) throw error;
}

/** Same bare-row insert as recordBulkNonDraftJob, but for the pre-processing "rejected" outcome (Section 27: a file rejected by client-side validation, e.g. oversized or wrong type, before any processing was even attempted) — batched as one multi-row insert since these are cheap, synchronous rejections with no per-item async work. */
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

export interface ImportBatchSummary {
  id: string;
  label: string;
  content_type: string;
  created_at: string;
  counts: Record<string, number>;
  total: number;
}

/**
 * Persistent batch HISTORY list (Section 6/21: "Legal Library → Import
 * Batches... date / source / count / status summary"). Deliberately no
 * new columns on import_batches for the counts — they're computed by
 * aggregating import_jobs.status client-side, so there is no redundant
 * denormalized count that could drift out of sync with the real per-job
 * rows (Section 30: prefer the existing schema over adding structure that
 * merely mirrors data already derivable from it).
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
        return { id: b.id, label: b.label, content_type: b.content_type, created_at: b.created_at, counts, total };
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
          ? supabase.from("case_law").select("id, case_name, citation, original_filename, review_status").in("id", caseLawIds)
          : Promise.resolve({ data: [] as { id: string; case_name: string; citation: string; original_filename: string | null; review_status: string }[] }),
        statuteIds.length > 0
          ? supabase.from("statutes").select("id, title, code, original_filename, review_status").in("id", statuteIds)
          : Promise.resolve({ data: [] as { id: string; title: string; code: string; original_filename: string | null; review_status: string }[] }),
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
          created_at: j.created_at,
          filename: readBareJobFilename(j.extracted_metadata) ?? "(unknown file)",
          displayName: null,
          reviewStatus: null,
        };
      });

      return { batch, rows };
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
        ? extractCaseLawMetadataWithConfidence(text, normalizedPages)
        : { fields: {}, caseNameConfidence: "none" as const };
      const proposed = extraction.fields;
      const tags = usableForMetadata ? proposeTags(text) : [];
      // Prefer hashing the original file's bytes when one is attached (the
      // authoritative source); fall back to the pasted/typed text hash so a
      // PDF with no text yet still gets a real duplicate-detection signal
      // instead of silently having none.
      const hash = input.file ? await sha256File(input.file) : text ? await sha256Text(text) : null;

      const duplicates = hash || text
        ? await findCaseLawDuplicates({
            documentHash: hash ?? undefined,
            neutralCitation: proposed.neutral_citation,
            caseName: input.known.case_name ?? proposed.case_name,
            court: input.known.court,
          })
        : [];

      const { data, error } = await supabase.rpc("create_case_law_import", {
        p_case_name:
          input.known.case_name ??
          (extraction.caseNameConfidence === "high" ? proposed.case_name : undefined) ??
          "Untitled (pending review)",
        p_citation: input.known.citation,
        p_court: input.known.court,
        p_jurisdiction: input.known.jurisdiction,
        p_court_id: input.known.court_id ?? null,
        p_jurisdiction_id: input.known.jurisdiction_id ?? null,
        p_neutral_citation: proposed.neutral_citation ?? null,
        p_reported_citation: proposed.reported_citation ?? null,
        p_decided_date: input.known.decided_date ?? proposed.decided_date_guess ?? null,
        p_full_text: text || null,
        p_source_url: input.source_url,
        p_source_id: input.source_id,
        p_original_filename: input.original_filename,
        p_document_hash: hash,
        p_batch_id: input.batch_id,
        p_extracted_metadata: {
          ...proposed,
          _extraction: envelope,
          _metadataConfidence: {
            caseName: extraction.caseNameConfidence,
            // Records WHERE the final case_name actually came from, not
            // just how confident the document-text extraction was —
            // these can differ (e.g. a bulk item with low/none document
            // confidence whose name was filled in from the filename
            // instead). Falls back to "document"/"curator" heuristically
            // only when the caller (single-import form) didn't already
            // know: a non-empty known.case_name with no explicit source
            // came from a human typing into the form.
            caseNameSource:
              input.known.case_name_source ??
              (input.known.case_name ? "curator" : extraction.caseNameConfidence === "high" ? "document" : undefined),
          },
        } as unknown as Json,
        p_proposed_tags: tags,
        p_duplicate_warning:
          duplicates.length > 0
            ? duplicates.map((d) => `${d.strength}: ${d.reason} (${d.existingLabel})`).join(" | ")
            : null,
      });
      if (error) throw error;
      const row = data?.[0];
      if (!row) throw new Error("create_case_law_import did not return an id.");

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
          `Draft created with ${result.duplicates.length} possible duplicate warning(s) — review before publishing.`,
        );
      } else {
        toast.success("Draft created — sent to Review Queue.");
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
      const tags = usableForMetadata ? proposeTags(text) : [];
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
        p_jurisdiction_id: input.known.jurisdiction_id ?? null,
        p_short_title: input.known.short_title ?? null,
        p_full_text: text || null,
        p_source_url: input.source_url,
        p_source_id: input.source_id,
        p_original_filename: input.original_filename,
        p_document_hash: hash,
        p_batch_id: input.batch_id,
        p_extracted_metadata: { provisionCount: provisions.length, _extraction: envelope } as unknown as Json,
        p_proposed_tags: tags,
        p_duplicate_warning:
          duplicates.length > 0
            ? duplicates.map((d) => `${d.strength}: ${d.reason} (${d.existingLabel})`).join(" | ")
            : null,
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
          `Draft created (${result.provisionCount} provisions) with ${result.duplicates.length} possible duplicate warning(s) — review before publishing.`,
        );
      } else {
        toast.success(`Draft created with ${result.provisionCount} provisions — sent to Review Queue.`);
      }
      void queryClient.invalidateQueries({ queryKey: legislationKeys.reviewQueue });
      void queryClient.invalidateQueries({ queryKey: importJobKeys.all });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });
}
