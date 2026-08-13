/**
 * Bulk ingestion queue primitives — PRODUCTION DOCUMENT INGESTION PHASE,
 * Sections 10-13, 27. Deliberately a pure, dependency-free module (no
 * Supabase, no React) so the bounded-concurrency runner and the resource
 * limits can be unit-tested in isolation. The actual per-file work
 * (hash/duplicate-check/extract/propose-metadata/create-draft) is wired
 * up in src/hooks/legal-library/use-bulk-import.ts, which supplies a
 * `worker` callback into `runBoundedConcurrent` below.
 *
 * CRITICAL INVARIANT (Section 18 — "No global 'current file metadata' may
 * leak between jobs"): every item owns its own file/hash/text/status.
 * There is no module-level mutable state anywhere in this file. Each
 * `worker(item, index)` call operates on exactly one item; nothing here
 * ever reads or writes a variable shared across items. This is what
 * makes "one file's data cannot contaminate another's" a STRUCTURAL
 * property of the abstraction, not just caller discipline — the same
 * category of bug the single-file stale-state fix (resetFileDerivedState)
 * addressed for sequential file selection, now addressed for concurrent
 * bulk processing.
 */

// ---------------------------------------------------------------------------
// Bounded-concurrency runner
// ---------------------------------------------------------------------------

/** Documents typically aren't huge, but extraction is CPU/memory work happening in the browser main thread's async tasks — 2-4 concurrent is the explicit guidance (Section 12). Kept as a named constant, not a magic number scattered through call sites (Section 27). */
export const DEFAULT_BULK_CONCURRENCY = 3;

/**
 * Runs `worker` over every item in `items`, never more than `concurrency`
 * calls in flight at once, and NEVER lets one item's failure stop the
 * rest of the batch — "ONE BAD FILE MUST NOT ABORT THE ENTIRE BATCH"
 * (Section 12) is enforced here structurally: a throw from `worker` is
 * caught and swallowed (the worker itself is expected to record the
 * failure onto its own item — see use-bulk-import.ts — this catch is
 * only a last-resort safety net, not the primary error-handling path).
 */
export async function runBoundedConcurrent<T>(
  items: T[],
  worker: (item: T, index: number) => Promise<void>,
  concurrency: number = DEFAULT_BULK_CONCURRENCY,
): Promise<void> {
  if (items.length === 0) return;
  let nextIndex = 0;

  async function runSlot(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      try {
        await worker(items[i], i);
      } catch {
        // Safety net only -- see doc comment above. Never propagate.
      }
    }
  }

  const slotCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: slotCount }, () => runSlot()));
}

// ---------------------------------------------------------------------------
// Per-file queue item state
// ---------------------------------------------------------------------------

/**
 * Section 12's state list, adapted to what this build's pipeline actually
 * distinguishes (no separate "uploading" state — the original file is
 * uploaded as part of "extracting" in this implementation, since Storage
 * upload only happens after a draft row exists — see IX below and
 * use-bulk-import.ts's ordering notes).
 */
export type BulkItemStatus =
  | "queued"
  | "hashing"
  | "duplicate"
  | "extracting"
  | "needs_review"
  | "ready"
  | "failed"
  | "completed"
  | "rejected";

export const BULK_STATUS_LABEL: Record<BulkItemStatus, string> = {
  queued: "Queued",
  hashing: "Checking for duplicates…",
  duplicate: "Duplicate detected",
  extracting: "Extracting text…",
  needs_review: "Needs review",
  ready: "Ready for review",
  failed: "Failed",
  completed: "Draft created",
  rejected: "Rejected before processing",
};

export interface BulkQueueItem {
  id: string;
  file: File;
  status: BulkItemStatus;
  /** Short, human-readable reason — never a raw stack trace (same principle as import_jobs.error_summary). */
  error: string | null;
  /** True only for an EXACT file-hash duplicate (Section 15) — a possible-same-case match (similar name/citation, different bytes) is surfaced as a duplicate_warning on the created draft instead, never silently skipped. */
  isDuplicate: boolean;
  duplicateReason: string | null;
  caseLawId: string | null;
  statuteId: string | null;
}

export function createBulkQueueItem(file: File): BulkQueueItem {
  return {
    id: crypto.randomUUID(),
    file,
    status: "queued",
    error: null,
    isDuplicate: false,
    duplicateReason: null,
    caseLawId: null,
    statuteId: null,
  };
}

/** Coarse counts for the batch summary header (Section 11: "Ready 47 / Duplicates 3 / ..."), never a fake percentage — only counts of items actually in each real status (Section 29). */
export function summarizeBulkQueue(items: BulkQueueItem[]): Record<BulkItemStatus, number> {
  const counts: Record<BulkItemStatus, number> = {
    queued: 0,
    hashing: 0,
    duplicate: 0,
    extracting: 0,
    needs_review: 0,
    ready: 0,
    failed: 0,
    completed: 0,
    rejected: 0,
  };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Resource limits (Section 27) — named constants, not magic numbers.
// ---------------------------------------------------------------------------

/** Mirrors the `documents` Storage bucket's `file_size_limit` (supabase/migrations/0011_storage.sql) exactly, so a curator gets a clear client-side rejection instead of a late, confusing Storage-API error for the same limit. */
export const MAX_FILE_SIZE_BYTES = 26_214_400; // 25 MB

/** Mirrors the `documents` Storage bucket's `allowed_mime_types` (0011_storage.sql + 0068_documents_markdown_mime.sql) exactly — this is NOT a new security boundary (the bucket itself is the real enforcement point, already in place before this phase), only a proactive UX check so bulk-mode gives per-file feedback immediately rather than after an upload round-trip. */
export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
])

const ALLOWED_UPLOAD_EXTENSIONS = /\.(pdf|txt|md|markdown|docx|doc|png|jpe?g|webp)$/i

/** A curator selecting an entire archive folder is exactly the scenario this phase targets — but "the browser attempts 5,000 x 200MB PDFs simultaneously" (Section 27) must not be possible. This is a sanity ceiling on ONE bulk batch, not a claim about the library's eventual total size. */
export const MAX_BULK_FILES_PER_BATCH = 200;

export interface FileValidationResult {
  ok: boolean;
  reason?: string;
}

/** Client-side pre-check mirroring the Storage bucket's own enforcement — never the ONLY enforcement (RLS + bucket limits still apply server-side regardless of what this function decides), just an early, clear per-file rejection message for bulk mode (Section 27: "The UI should explain rejected files clearly"). */
export function validateFileForUpload(file: File): FileValidationResult {
  if (file.size === 0) {
    return { ok: false, reason: "File is empty." };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, reason: `File exceeds the ${(MAX_FILE_SIZE_BYTES / 1_048_576).toFixed(0)} MB limit.` };
  }
  const mime = file.type || "application/octet-stream"
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(mime) && !ALLOWED_UPLOAD_EXTENSIONS.test(file.name)) {
    return { ok: false, reason: `File type "${mime}" is not supported.` }
  }
  return { ok: true };
}

/** Applied to an entire FileList/array before building the queue — a batch over the ceiling is rejected as a whole with a clear message rather than silently truncated (silent truncation would mean the curator doesn't know 40 of their 240 files were dropped). */
export function validateBulkBatchSize(fileCount: number): FileValidationResult {
  if (fileCount > MAX_BULK_FILES_PER_BATCH) {
    return {
      ok: false,
      reason: `${fileCount} files selected — the maximum for a single bulk batch is ${MAX_BULK_FILES_PER_BATCH}. Split this into smaller batches.`,
    };
  }
  return { ok: true };
}
