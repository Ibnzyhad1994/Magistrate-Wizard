import { useState } from "react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/utils";
import {
  runBoundedConcurrent,
  createBulkQueueItem,
  validateFileForUpload,
  validateBulkBatchSize,
  DEFAULT_BULK_CONCURRENCY,
  type BulkQueueItem,
} from "@/lib/bulk-ingestion-queue";
import {
  extractCaseLawMetadataWithConfidence,
  extractCaseNameFromFilename,
  normalizeWhitespace,
  readFileAsText,
} from "@/lib/legal-extraction";
import { matchCanonicalCourtScored, type CourtLike } from "@/lib/legal-taxonomy-match";
import {
  runPdfExtractionPipeline,
  buildTextFileEnvelope,
  emptyExtractionEnvelope,
} from "@/lib/extraction-pipeline";
import { useIngestCaseLaw } from "@/hooks/legal-library/use-import-jobs";
import { useCreateImportBatch, checkExactDuplicateByHash } from "@/hooks/legal-library/use-import-jobs";
import { sha256File } from "@/lib/legal-extraction";

/**
 * Bulk Case Law ingestion orchestration (PRODUCTION DOCUMENT INGESTION
 * PHASE, Sections 10-18). Deliberately reuses the EXACT SAME per-file
 * primitives the single-file New Import flow uses (runPdfExtractionPipeline,
 * extractCaseLawMetadataWithConfidence, matchCanonicalCourtScored,
 * useIngestCaseLaw's create_case_law_import RPC call) rather than a
 * parallel reimplementation — bulk mode is "run the already-correct
 * single-file pipeline for many files, with bounded concurrency and an
 * upfront exact-duplicate check," not a second ingestion engine that
 * could drift from the first. Every draft this creates lands in the
 * Review Queue exactly like a single-file import — nothing is
 * auto-published, matching "BULK INGESTION IS NOT BULK PUBLICATION"
 * (Section 3).
 *
 * NO SHARED MUTABLE STATE ACROSS FILES (Section 18): the worker passed to
 * runBoundedConcurrent closes over only the one `item` it's given —
 * hash/text/pages/metadata/court/status all live on that item's own
 * object. Nothing here is a module- or hook-level "current file" variable
 * that a second file's concurrent processing could stomp on.
 */
export function useBulkImportCaseLaw() {
  const [items, setItems] = useState<BulkQueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const ingestCaseLaw = useIngestCaseLaw();
  const createBatch = useCreateImportBatch();

  function patchItem(id: string, patch: Partial<BulkQueueItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function startBulkImport(
    files: File[],
    opts: { sourceId: string | null; courts: CourtLike[]; jurisdictions: { id: string; name: string }[] },
  ) {
    const batchSizeCheck = validateBulkBatchSize(files.length);
    if (!batchSizeCheck.ok) {
      toast.error(batchSizeCheck.reason ?? "Too many files selected.");
      return;
    }
    if (files.length === 0) return;

    const initial = files.map((file) => {
      const item = createBulkQueueItem(file);
      const validation = validateFileForUpload(file);
      if (!validation.ok) {
        item.status = "rejected";
        item.error = validation.reason ?? "Rejected.";
      }
      return item;
    });
    setItems(initial);
    setIsRunning(true);

    let batchId: string | null = null;
    try {
      const batch = await createBatch.mutateAsync({
        label: `Bulk import — ${new Date().toLocaleDateString()} — ${files.length} document${files.length === 1 ? "" : "s"}`,
        content_type: "case_law",
      });
      batchId = batch.id;
    } catch (e) {
      // A batch is a convenience grouping, not a hard prerequisite for any
      // single job (import_jobs.batch_id is nullable) — if creating it
      // fails for some reason, still process every file individually
      // rather than aborting the entire operation.
      toast.warning(`Could not create a batch record (${getErrorMessage(e)}) — continuing without one.`);
    }

    const processable = initial.filter((it) => it.status !== "rejected");

    await runBoundedConcurrent(
      processable,
      async (item) => {
        try {
          patchItem(item.id, { status: "hashing" });
          const hash = await sha256File(item.file);
          const duplicate = await checkExactDuplicateByHash("case_law", hash);
          if (duplicate) {
            patchItem(item.id, {
              status: "duplicate",
              isDuplicate: true,
              duplicateReason: `Identical to an existing record: ${duplicate.label}`,
            });
            return;
          }

          patchItem(item.id, { status: "extracting" });
          const lowerName = item.file.name.toLowerCase();
          const isPdf = item.file.type === "application/pdf" || lowerName.endsWith(".pdf");
          const isTxt = item.file.type === "text/plain" || lowerName.endsWith(".txt");

          const envelope = isTxt
            ? buildTextFileEnvelope(await readFileAsText(item.file))
            : isPdf
              ? await runPdfExtractionPipeline(item.file)
              : emptyExtractionEnvelope();

          let caseName: string | undefined;
          /** Provenance for `caseName` (Section 16/17/35-J) — never left ambiguous. Recorded on the created draft's `_metadataConfidence.caseNameSource` so the Review Queue can show "proposed from filename, please verify" rather than presenting a filename guess as if it came from the document itself. */
          let caseNameSource: "document" | "filename" | undefined;
          let reportedCitation: string | undefined;
          let neutralCitation: string | undefined;
          let decidedDate: string | undefined;
          let courtId: string | null = null;
          let jurisdictionId: string | null = null;
          let courtName = "";
          let jurisdictionName = "";

          if (envelope.status === "extracted" || envelope.status === "low_quality") {
            const pages = envelope.pages.map((p) => ({ pageNumber: p.pageNumber, text: normalizeWhitespace(p.text) }));
            const normalizedText = normalizeWhitespace(envelope.text);
            const { fields, caseNameConfidence } = extractCaseLawMetadataWithConfidence(normalizedText, pages);
            if (caseNameConfidence === "high" && fields.case_name) {
              caseName = fields.case_name;
              caseNameSource = "document";
            }
            reportedCitation = fields.reported_citation;
            neutralCitation = fields.neutral_citation;
            decidedDate = fields.decided_date_guess;

            const matched = matchCanonicalCourtScored(envelope.text, opts.courts);
            if (matched && matched.confidence !== "low") {
              courtId = matched.court.id;
              courtName = matched.court.canonical_name;
              jurisdictionId = matched.court.jurisdiction_id ?? null;
              if (jurisdictionId) {
                jurisdictionName = opts.jurisdictions.find((j) => j.id === jurisdictionId)?.name ?? "";
              }
            }
          }

          // Filename-assisted SECONDARY support (Section 16) — only fills
          // gaps the document text left, never overrides a confident
          // document-text value. Never trusted as "high" confidence.
          if (!caseName || (!reportedCitation && !neutralCitation)) {
            const fromFilename = extractCaseNameFromFilename(item.file.name);
            if (!caseName && fromFilename?.case_name) {
              caseName = fromFilename.case_name;
              caseNameSource = "filename";
            }
            if (!reportedCitation && !neutralCitation) {
              reportedCitation = fromFilename?.reported_citation;
              neutralCitation = fromFilename?.neutral_citation;
            }
          }

          const result = await ingestCaseLaw.mutateAsync({
            text: envelope.text,
            file: item.file,
            extractionEnvelope: envelope,
            source_url: null,
            source_id: opts.sourceId,
            original_filename: item.file.name,
            batch_id: batchId,
            known: {
              case_name: caseName,
              case_name_source: caseNameSource,
              citation: reportedCitation ?? neutralCitation ?? "",
              // Legacy free-text columns. NEVER pass "" here even when
              // court_id/jurisdiction_id ARE confidently resolved -- ""
              // is itself one of publication-validation.ts's
              // PLACEHOLDER_VALUES, so an empty string would incorrectly
              // trip "Court is missing" / "Jurisdiction is missing" on a
              // record that was actually matched correctly. Use the real
              // matched name when we have one, and only fall back to the
              // literal placeholder text when we genuinely don't.
              court: courtName || "Court",
              jurisdiction: jurisdictionName || "Jurisdiction",
              court_id: courtId,
              jurisdiction_id: jurisdictionId,
              decided_date: decidedDate ?? null,
            },
          });

          const needsReview =
            !caseName || !courtId || !jurisdictionId || envelope.status === "low_quality" || envelope.status === "requires_ocr";
          patchItem(item.id, {
            status: needsReview ? "needs_review" : "ready",
            caseLawId: result.caseLawId,
          });
        } catch (e) {
          patchItem(item.id, { status: "failed", error: getErrorMessage(e) });
        }
      },
      DEFAULT_BULK_CONCURRENCY,
    );

    setIsRunning(false);
  }

  function reset() {
    setItems([]);
  }

  return { items, isRunning, startBulkImport, reset };
}
