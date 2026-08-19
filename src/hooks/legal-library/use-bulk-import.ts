import { useRef, useState } from "react";
import { toast } from "sonner";
import { getErrorMessage, formatDateTime } from "@/lib/utils";
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
  shouldProposeCaseName,
} from "@/lib/legal-extraction";
import { matchCanonicalCourtScored, type CourtLike } from "@/lib/legal-taxonomy-match";
import { ingestDocument } from "@/lib/ingest-document";
import { useIngestCaseLaw } from "@/hooks/legal-library/use-import-jobs";
import { uploadDocumentToEntity } from "@/hooks/use-documents";
import {
  useCreateImportBatch,
  checkExactDuplicateByHash,
  checkCanonicalCitationConflict,
  recordBulkNonDraftJob,
  recordBulkRejectedJobs,
} from "@/hooks/legal-library/use-import-jobs";
import { sha256File } from "@/lib/legal-extraction";

/**
 * Bulk Case Law ingestion orchestration (PRODUCTION DOCUMENT INGESTION
 * PHASE, Sections 10-18). Deliberately reuses the EXACT SAME per-file
 * primitives the single-file New Import flow uses (ingestDocument,
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
  // Exposed so the panel can offer "Open batch" once processing finishes
  // (Section 18) — the temporary in-memory `items` list above is a live
  // progress view, not the long-term record; this is how the UI hands the
  // curator off to the persistent one without them needing to already
  // know Import Batches exists or dig for the right row themselves.
  const [lastBatchId, setLastBatchId] = useState<string | null>(null);
  const ingestCaseLaw = useIngestCaseLaw();
  const createBatch = useCreateImportBatch();
  // Section 17 (Retry): a retry re-runs `processOneItem` for ONE item
  // still held in memory from this same session — the original File
  // object cannot survive a page reload/later session (browsers give no
  // way to reopen a File later), so these refs only need to track the
  // MOST RECENT run's batch/opts, not a full history. A retry always
  // rejoins the batch the item originally came from.
  const lastBatchIdRef = useRef<string | null>(null);
  const lastOptsRef = useRef<BulkOpts | null>(null);

  function patchItem(id: string, patch: Partial<BulkQueueItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  type BulkOpts = {
    sourceId: string | null;
    /** Source repository's display name, when one is assigned — used only to make the batch's own label easier to recognize later ("CCJ — Bulk import — 12 Aug 2026, 18:45 — 43 documents"), never persisted as structured provenance itself (that's still source_id, per-job, Section 33). */
    sourceName?: string | null;
    courts: CourtLike[];
    jurisdictions: { id: string; name: string }[];
  };

  /**
   * The full per-file pipeline (hash → exact-duplicate check → extract →
   * propose metadata → citation-conflict check → create draft), extracted
   * into its own function so it can be called BOTH from the bounded-
   * concurrency batch run below AND from `retryItem` (Section 17) for a
   * single failed item, without duplicating this logic. `persistenceFailures`
   * is passed by the caller as a one-element array so both call sites can
   * observe/accumulate it (a plain closed-over `let` would work for the
   * batch run but not for a later standalone retry call).
   */
  async function processOneItem(
    item: BulkQueueItem,
    batchId: string | null,
    opts: BulkOpts,
    persistenceFailureCounter: { count: number },
  ) {
    try {
      patchItem(item.id, { status: "hashing" });
      const hash = await sha256File(item.file);
      const duplicate = await checkExactDuplicateByHash("case_law", hash);
      if (duplicate) {
        const reason = `Identical to an existing record: ${duplicate.label}`;
        patchItem(item.id, { status: "duplicate", isDuplicate: true, duplicateReason: reason });
        // Own try/catch (not the outer per-item one below) — a
        // transient failure PERSISTING this outcome must never flip
        // the local UI status to "failed" for a file that genuinely
        // IS a duplicate; that would be exactly the "duplicate shown
        // as failed" bug this pass exists to eliminate, just from a
        // different cause. Counted toward the invariant instead.
        try {
          await recordBulkNonDraftJob({
            batch_id: batchId,
            content_type: "case_law",
            status: "duplicate",
            reason,
            source_id: opts.sourceId,
            originalFilename: item.file.name,
            duplicateOfId: duplicate.id,
          });
        } catch {
          persistenceFailureCounter.count += 1;
        }
        return;
      }

      patchItem(item.id, { status: "extracting", progressNote: null });
      const envelope = await ingestDocument(item.file, {
        onOcrProgress: ({ page, total }) => {
          patchItem(item.id, { progressNote: `Recognizing page ${page} of ${total}` });
        },
      });

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
        const { fields, caseNameConfidence, citationSource } = extractCaseLawMetadataWithConfidence(
          normalizedText,
          pages,
          { filename: item.file.name },
        );
        if (shouldProposeCaseName(caseNameConfidence, envelope.ocrUsed) && fields.case_name) {
          caseName = fields.case_name;
          caseNameSource = citationSource === "filename" && caseNameConfidence === "low" ? "filename" : "document";
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
      const fromFilename = extractCaseNameFromFilename(item.file.name);
      if (!caseName && fromFilename?.case_name) {
        caseName = fromFilename.case_name;
        caseNameSource = "filename";
      }
      // WIR/WLR files are named after THIS report's citation. Document
      // text often matches a cited authority first (e.g. "[1987] AC 352"
      // inside Perreira v Cummings (1995) 54 WIR 233). Prefer the
      // filename's own reported citation as the record identity.
      if (fromFilename?.reported_citation) {
        reportedCitation = fromFilename.reported_citation;
      } else if (!reportedCitation && !neutralCitation) {
        reportedCitation = fromFilename?.reported_citation;
        neutralCitation = fromFilename?.neutral_citation;
      }

      // CANONICAL CITATION conflict pre-check — the actual root cause
      // of the live "Duplicate shown as Failed" bug: case_law.citation
      // has a unique index scoped to canonical rows
      // (case_law_citation_canonical_unique_idx), but until this fix
      // nothing checked it before calling create_case_law_import. A
      // bulk item whose citation matches an existing canonical case
      // (a different scan/report of the SAME case — a "possible
      // record duplicate," Section 9/15, not a byte-identical file)
      // would hit that raw Postgres constraint and surface as a
      // generic "Failed" with the misleading message "That already
      // exists." Checking it here means this is now a DUPLICATE
      // outcome, never a failure, and the doomed insert is never
      // attempted.
      const finalCitation = reportedCitation ?? neutralCitation ?? "";
      if (finalCitation) {
        const citationConflict = await checkCanonicalCitationConflict(finalCitation);
        if (citationConflict) {
          // This is a "possible same-case, different file" conflict
          // (Section 9/10/11) — the citation matches an existing
          // canonical record, but a different citation-format PDF,
          // scan, or report version is genuinely useful provenance,
          // not a wasted upload. The polymorphic `documents` table
          // already supports many documents per entity_id (no
          // uniqueness constraint on entity_type/entity_id — verified
          // by inspection of 0040, no schema change needed), so this
          // attaches the new file directly to the EXISTING authority
          // as an additional source rather than silently discarding
          // it. It becomes visible immediately on that record's
          // Documents panel for a curator to review/relabel — never a
          // second canonical draft, never a mysterious dead end.
          let attachedAsAlternateSource = false;
          try {
            await uploadDocumentToEntity("case_law", citationConflict.id, item.file);
            attachedAsAlternateSource = true;
          } catch {
            // Best-effort — the citation-conflict outcome itself is
            // still correctly recorded below either way; only the
            // extra "we also kept your file" behavior is at risk here.
          }
          const reason = attachedAsAlternateSource
            ? `A canonical case with citation "${finalCitation}" already exists: ${citationConflict.label}. Not re-imported as a new record — this file was attached to the existing authority as an alternate source for curator review.`
            : `A canonical case with citation "${finalCitation}" already exists: ${citationConflict.label}. Not re-imported — review the existing record if this is a different source for the same case.`;
          patchItem(item.id, { status: "duplicate", isDuplicate: true, duplicateReason: reason });
          // Same reasoning as the hash-duplicate branch above — a
          // persistence hiccup here must not relabel a genuine
          // duplicate as "failed" via the outer catch.
          try {
            await recordBulkNonDraftJob({
              batch_id: batchId,
              content_type: "case_law",
              status: "duplicate",
              reason,
              source_id: opts.sourceId,
              originalFilename: item.file.name,
              duplicateOfId: citationConflict.id,
            });
          } catch {
            persistenceFailureCounter.count += 1;
          }
          return;
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
          citation: finalCitation,
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
        !caseName ||
        !courtId ||
        !jurisdictionId ||
        envelope.status === "low_quality" ||
        envelope.status === "requires_ocr" ||
        envelope.ocrUsed
      patchItem(item.id, {
        status: needsReview ? "needs_review" : "ready",
        caseLawId: result.caseLawId,
      });
    } catch (e) {
      // Defense-in-depth for the citation-conflict pre-check above:
      // two items in the SAME batch sharing a citation could both
      // pass the pre-check concurrently (bounded concurrency runs up
      // to DEFAULT_BULK_CONCURRENCY items at once, and neither exists
      // in the DB yet when both check). Whichever inserts second still
      // hits the real Postgres constraint — but getErrorMessage now
      // recognizes it (see utils.ts), so this is reclassified as a
      // duplicate rather than left as a generic, misleading failure.
      const message = getErrorMessage(e);
      const isCitationConflict = message.includes("A canonical case with this citation already exists");
      patchItem(item.id, {
        status: isCitationConflict ? "duplicate" : "failed",
        isDuplicate: isCitationConflict,
        duplicateReason: isCitationConflict ? message : null,
        error: isCitationConflict ? null : message,
      });
      try {
        await recordBulkNonDraftJob({
          batch_id: batchId,
          content_type: "case_law",
          status: isCitationConflict ? "duplicate" : "failed",
          reason: message,
          source_id: opts.sourceId,
          originalFilename: item.file.name,
          duplicateOfId: null,
        });
      } catch {
        persistenceFailureCounter.count += 1;
        // Best-effort — the outcome is still shown live in this
        // session's queue UI even if persisting it failed too.
      }
    }
  }

  async function startBulkImport(files: File[], opts: BulkOpts) {
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
    setLastBatchId(null);

    let batchId: string | null = null;
    // Batch accounting invariant tracking (Section 5): every persistence
    // call below is still "best-effort" (a transient insert failure must
    // never block the live queue UI from showing the outcome), but a
    // silent gap here is exactly how a batch ends up looking like the
    // reported bug (label says N, Batch Detail shows fewer). Instead of
    // swallowing these with no trace at all, count them and tell the
    // curator plainly at the end — the local queue UI is still correct
    // for this session, but Batch Detail won't have that row.
    const persistenceFailureCounter = { count: 0 };
    try {
      // Unambiguous en-GB date+time (never `toLocaleDateString()` — that
      // produces locale-ambiguous output like "8/12/2026", which reads as
      // 12 August to some viewers and 8 December to others; exactly the
      // class of bug this app's DD/MM/YYYY date-entry work already fixed
      // elsewhere). Time is included (not just the date) so two batches
      // started the same day are still distinguishable in the batch list.
      const prefix = opts.sourceName ? `${opts.sourceName} — ` : "";
      const label = `${prefix}Bulk import — ${formatDateTime(new Date())} — ${files.length} document${files.length === 1 ? "" : "s"}`;
      const batch = await createBatch.mutateAsync({
        label,
        content_type: "case_law",
        // The batch accounting invariant (Section 5): every one of these
        // `files.length` originally-selected files — including ones about
        // to be rejected by client-side validation below — must end up as
        // exactly one persisted import_jobs row. This is the number that
        // invariant is checked against, recorded once, here.
        expected_file_count: files.length,
      });
      batchId = batch.id;
      setLastBatchId(batch.id);
    } catch (e) {
      // A batch is a convenience grouping, not a hard prerequisite for any
      // single job (import_jobs.batch_id is nullable) — if creating it
      // fails for some reason, still process every file individually
      // rather than aborting the entire operation.
      toast.warning(`Could not create a batch record (${getErrorMessage(e)}) — continuing without one.`);
    }

    const processable = initial.filter((it) => it.status !== "rejected");
    const rejected = initial.filter((it) => it.status === "rejected");
    if (rejected.length > 0) {
      // Persist rejections too (Section 6/23) — a curator returning to
      // this batch later should see ALL 7 files' fates, including the
      // ones rejected before processing even began, not just the subset
      // that made it into the queue.
      try {
        await recordBulkRejectedJobs(
          rejected.map((it) => ({
            batch_id: batchId,
            content_type: "case_law",
            reason: it.error ?? "Rejected before processing.",
            originalFilename: it.file.name,
          })),
        );
      } catch {
        persistenceFailureCounter.count += rejected.length;
        // Non-fatal — the rejection is still shown live in this session's
        // queue UI even if persisting it failed for some reason.
      }
    }

    lastBatchIdRef.current = batchId;
    lastOptsRef.current = opts;

    await runBoundedConcurrent(
      processable,
      (item) => processOneItem(item, batchId, opts, persistenceFailureCounter),
      DEFAULT_BULK_CONCURRENCY,
    );

    setIsRunning(false);
    const persistenceFailures = persistenceFailureCounter.count;
    if (persistenceFailures > 0) {
      // The batch accounting invariant (Section 5) is violated for this
      // batch — say so plainly rather than let the curator discover it
      // later as an unexplained missing row in Batch Detail. The queue
      // above is still accurate for this session; only the PERSISTED
      // record is short by this many outcomes.
      toast.warning(
        `${persistenceFailures} outcome${persistenceFailures === 1 ? "" : "s"} in this batch could not be saved to the persistent record — they're shown above, but won't appear in Import Batches. Try refreshing the batch later; if this recurs, check your connection.`,
      );
    }
  }

  function reset() {
    setItems([]);
    setLastBatchId(null);
  }

  /**
   * Retry ONE failed item, in place, from the SAME session's live queue
   * (Section 17). Deliberately narrow — this is not "Retry all" (Section
   * 17 explicitly warns against a blanket retry), and it only works while
   * the original `File` object is still held in `items` (the browser
   * gives no way to reopen a File after the page/session ends — see
   * BatchJobRow's "no Retry in Batch Detail" note for the other half of
   * this honest limitation). Reuses the SAME batch_id the item was
   * originally part of, so a retried item's outcome still lands in the
   * batch it came from rather than creating an orphaned, disconnected
   * job. Never creates a duplicate Case Law row: processOneItem's own
   * hash/citation checks run again exactly as they would for a first
   * attempt, so a retry that would have collided with something created
   * since the original attempt is correctly caught as a duplicate, not
   * blindly re-inserted.
   */
  async function retryItem(itemId: string) {
    const item = items.find((it) => it.id === itemId);
    if (!item || item.status !== "failed") return;
    const opts = lastOptsRef.current;
    if (!opts) return;
    patchItem(itemId, { status: "queued", error: null });
    const persistenceFailureCounter = { count: 0 };
    await processOneItem(item, lastBatchIdRef.current, opts, persistenceFailureCounter);
    if (persistenceFailureCounter.count > 0) {
      toast.warning("This outcome could not be saved to the persistent batch record — it's shown above, but won't appear in Import Batches.");
    }
  }

  return { items, isRunning, startBulkImport, reset, lastBatchId, retryItem };
}
