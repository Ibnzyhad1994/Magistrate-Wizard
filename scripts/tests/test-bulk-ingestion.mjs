// Regression tests for bulk ingestion (PRODUCTION DOCUMENT INGESTION
// PHASE, Sections 10-18, 27, 35) — the PURE, dependency-free layer only:
// src/lib/bulk-ingestion-queue.ts (bounded concurrency, validators, queue
// item shape) and the filename-fallback metadata helper in
// src/lib/legal-extraction.ts. This deliberately does NOT exercise
// src/hooks/legal-library/use-bulk-import.ts itself, because that hook is
// a React Query hook wired to Supabase RPCs (useIngestCaseLaw,
// useCreateImportBatch, checkExactDuplicateByHash) — genuinely exercising
// it end to end would require a live Supabase project and a React runtime,
// neither of which exist in this sandbox. Per Section 34's own guidance
// ("if [a path] can't be implemented/tested... explicitly document rather
// than write fake tests"), this file is honest about that boundary rather
// than mocking Supabase into a shape that would only prove the mock
// works. What IS covered here is the entire part of the spec's BULK A-J
// test list that does not require a live backend: bounded concurrency,
// per-item independence/no-shared-state, partial-batch-failure survival,
// resource-limit validation, and filename-derived metadata extraction.
// The parts that DO require a live backend (BULK D/E exact-vs-possible
// duplicate detection against real `case_law`/`statutes` rows, and the
// full single-file ingestion pipeline each bulk item calls) are already
// covered end-to-end for the single-file case by
// test-extraction-pipeline.mjs / test-page-awareness.mjs / test-false-
// success-prevention.mjs — the bulk worker reuses those exact functions
// (see use-bulk-import.ts's header comment), so those code paths are not
// re-tested here as fresh assertions, only reused via the same primitives.
//
// Run with:
//   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-bulk-ingestion.mjs

import {
  runBoundedConcurrent,
  createBulkQueueItem,
  summarizeBulkQueue,
  validateFileForUpload,
  validateBulkBatchSize,
  MAX_FILE_SIZE_BYTES,
  MAX_BULK_FILES_PER_BATCH,
  DEFAULT_BULK_CONCURRENCY,
} from "@/lib/bulk-ingestion-queue";
import { extractCaseNameFromFilename } from "@/lib/legal-extraction";

let failures = 0;
function check(label, actual, expected) {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", expected);
    console.log("  actual:  ", actual);
    failures += 1;
  }
}
function checkTrue(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} - ${label}`);
  if (!cond) failures += 1;
}

function makeFile(name, sizeBytes = 1000, type = "application/pdf") {
  const bytes = new Uint8Array(sizeBytes);
  return new File([bytes], name, { type });
}

async function main() {
  // BULK A — N independent files each produce their own, distinct result;
  // nothing is shared between them.
  {
    const items = [1, 2, 3, 4, 5].map((n) => ({ id: `a-${n}`, result: null }));
    await runBoundedConcurrent(items, async (item) => {
      // Deliberately variable "work" (no fixed delay order) so any
      // accidental shared/last-writer-wins state would show up as a
      // wrong id here.
      await new Promise((r) => setTimeout(r, (5 - Number(item.id.split("-")[1])) * 2));
      item.result = `processed-${item.id}`;
    });
    checkTrue("A. all 5 items processed", items.every((it) => it.result !== null));
    checkTrue(
      "A. every item's result matches its OWN id (no cross-item leakage)",
      items.every((it) => it.result === `processed-${it.id}`),
    );
  }

  // BULK C / I — File A succeeds, File B throws, File C succeeds: the
  // batch must complete, B's failure must not corrupt or block A/C, and
  // A/C must never see B's (or each other's) data. runBoundedConcurrent's
  // per-worker try/catch is the safety net under test — no external
  // try/catch is added by this test's worker.
  {
    const items = [
      { id: "A", value: "alpha", result: null, threw: false },
      { id: "B", value: "beta", result: null, threw: false },
      { id: "C", value: "gamma", result: null, threw: false },
    ];
    await runBoundedConcurrent(items, async (item) => {
      if (item.id === "B") {
        item.threw = true;
        throw new Error("simulated extraction failure for B");
      }
      item.result = item.value.toUpperCase();
    });
    check("C/I. A completed successfully", items[0].result, "ALPHA");
    checkTrue("C/I. B's failure was recorded on B, not swallowed silently", items[1].threw);
    check("C/I. B has no result (failed safely, not a fabricated one)", items[1].result, null);
    check("C/I. C completed successfully despite B's failure", items[2].result, "GAMMA");
    checkTrue(
      "C/I. no metadata leaked between A/B/C (each item's value is still its own)",
      items[0].value === "alpha" && items[1].value === "beta" && items[2].value === "gamma",
    );
  }

  // BULK G — bounded concurrency: the number of workers active AT ONCE
  // must never exceed the concurrency limit, even with 12 items and a
  // limit of 3 (never "all 12 at once").
  {
    const concurrency = 3;
    const items = Array.from({ length: 12 }, (_, i) => ({ id: i }));
    let active = 0;
    let maxObservedActive = 0;
    await runBoundedConcurrent(
      items,
      async () => {
        active += 1;
        maxObservedActive = Math.max(maxObservedActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      },
      concurrency,
    );
    checkTrue(`G. max concurrent workers (${maxObservedActive}) never exceeded the limit (${concurrency})`, maxObservedActive <= concurrency);
    checkTrue("G. concurrency was actually exercised (more than 1 at a time)", maxObservedActive > 1);
    check("G. DEFAULT_BULK_CONCURRENCY is a small, sane bound (Section 12: 2-4 documents)", DEFAULT_BULK_CONCURRENCY >= 2 && DEFAULT_BULK_CONCURRENCY <= 4, true);
  }

  // BULK H — 50 synthetic items complete without state corruption: every
  // item's own index is still correctly associated with its own item
  // after concurrent processing (a shared-counter or last-writer-wins bug
  // would show up as a wrong/duplicate/missing index here).
  {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i, result: null }));
    await runBoundedConcurrent(items, async (item, index) => {
      await new Promise((r) => setTimeout(r, Math.random() * 3));
      item.result = { fromId: item.id, fromIndex: index };
    });
    checkTrue("H. all 50 items completed", items.every((it) => it.result !== null));
    checkTrue(
      "H. every item's callback index matches its own id (no cross-assignment)",
      items.every((it) => it.result.fromId === it.id && it.result.fromIndex === it.id),
    );
    const uniqueIds = new Set(items.map((it) => it.result.fromId));
    check("H. no duplicate/corrupted ids across the 50-item batch", uniqueIds.size, 50);
  }

  // BULK F — an oversized or invalid file is rejected WITHOUT aborting the
  // rest of the batch. The queue-building step (validateFileForUpload per
  // file, validateBulkBatchSize for the whole selection) is what
  // use-bulk-import.ts's startBulkImport calls before any processing
  // begins — tested directly here since it's pure and deterministic.
  {
    const oversized = makeFile("huge.pdf", MAX_FILE_SIZE_BYTES + 1);
    const oversizedResult = validateFileForUpload(oversized);
    checkTrue("F. oversized file is rejected", !oversizedResult.ok);
    checkTrue("F. oversized rejection reason is clear (Section 27: explain rejected files clearly)", !!oversizedResult.reason && oversizedResult.reason.length > 0);

    const wrongType = makeFile("virus.exe", 1000, "application/x-msdownload");
    checkTrue("F. disallowed MIME type is rejected", !validateFileForUpload(wrongType).ok);

    const empty = makeFile("empty.pdf", 0);
    checkTrue("F. empty file is rejected", !validateFileForUpload(empty).ok);

    const validPdf = makeFile("good.pdf", 2000);
    checkTrue("F. a normal, valid PDF is accepted", validateFileForUpload(validPdf).ok);

    // The batch-size ceiling rejects the WHOLE selection with a clear
    // message (Section 27) rather than silently truncating it.
    const overBatch = validateBulkBatchSize(MAX_BULK_FILES_PER_BATCH + 1);
    checkTrue("F. a batch over the file-count ceiling is rejected", !overBatch.ok);
    checkTrue("F. batch-size rejection reason is clear", !!overBatch.reason);
    checkTrue("F. a batch at exactly the ceiling is accepted", validateBulkBatchSize(MAX_BULK_FILES_PER_BATCH).ok);

    // One bad file among several good ones must not doom the whole batch
    // — the caller marks only the bad one "rejected" and still processes
    // the rest (mirrors startBulkImport's `initial.map` + `.filter`).
    const selection = [validPdf, oversized, makeFile("also-good.pdf", 3000)];
    const initial = selection.map((file) => {
      const item = createBulkQueueItem(file);
      const v = validateFileForUpload(file);
      if (!v.ok) {
        item.status = "rejected";
        item.error = v.reason ?? "Rejected.";
      }
      return item;
    });
    check("F. exactly one of three items was rejected", initial.filter((it) => it.status === "rejected").length, 1);
    check("F. the other two remain queued for processing", initial.filter((it) => it.status === "queued").length, 2);
    const summary = summarizeBulkQueue(initial);
    check("F. summarizeBulkQueue counts match (rejected)", summary.rejected, 1);
    check("F. summarizeBulkQueue counts match (queued)", summary.queued, 2);
  }

  // BULK J — filename-derived metadata is real, useful information when a
  // document has no reliable text (or is still processing), but must be
  // clearly a SEPARATE, secondary signal — never silently indistinguishable
  // from a document-text-derived proposal. This test proves the extractor
  // itself works correctly on realistic filenames; the caller-side
  // provenance marking (case_name_source: "filename", surfaced in the
  // Review Queue as "proposed from the file name, not the document text")
  // is implemented in use-bulk-import.ts / use-import-jobs.ts /
  // legal-library-admin-page.tsx and is a UI/RPC-payload concern outside
  // what this pure module can assert on directly.
  {
    const fromUnderscored = extractCaseNameFromFilename("The_State_v_Test_Appellant_(1973)_20_XYZ_138.pdf");
    checkTrue("J. underscored filename yields a case name", !!fromUnderscored?.case_name);
    checkTrue("J. underscored filename case name contains both parties", (fromUnderscored?.case_name ?? "").includes("Test Appellant"));
    checkTrue("J. underscored filename citation was captured", !!fromUnderscored?.reported_citation);

    const withDashSeparator = extractCaseNameFromFilename("Test_Respondent_(Anthony)_v_The_State_-_(1989)_42_XYZ_4.pdf");
    checkTrue("J. dash-separated filename yields a case name with no trailing dash", !!withDashSeparator?.case_name && !withDashSeparator.case_name.endsWith("-"));

    const noUsefulPattern = extractCaseNameFromFilename("scan0001.pdf");
    check("J. a filename with no case-name-shaped content yields nothing (never fabricated)", noUsefulPattern, undefined);
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
