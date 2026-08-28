/**
 * Legislation PDF viewer's pdfjs bootstrap — separate from
 * `src/lib/ocr/rasterize-pdf.ts`'s own loader (that module serves
 * ingestion-time OCR/text-extraction and must not be touched by this
 * viewer work). Same worker/cmaps/standard-fonts convention, applied to
 * raw bytes (already downloaded via the authenticated `documents`
 * Storage API) rather than a `File`, since the viewer never needs a
 * browser File object.
 */

export type PdfjsTextItem = {
  str: string;
  /** [a, b, c, d, e, f] PDF-space transform — position/scale of this run. */
  transform: number[];
  width: number;
  height: number;
};

export type PdfjsPage = {
  getViewport: (opts: { scale: number; rotation?: number }) => {
    width: number;
    height: number;
  };
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: unknown;
  }) => { promise: Promise<unknown>; cancel: () => void };
  getTextContent: () => Promise<{ items: unknown[] }>;
  cleanup: () => void;
};

/**
 * `numPages`/`getPage` from the resolved pdfjs document (PDFDocumentProxy),
 * merged with a `destroy` that closes over the LOADING TASK instead --
 * PDFDocumentProxy itself has no `destroy()` method in this pdfjs-dist
 * version (confirmed against node_modules/pdfjs-dist/types: only
 * PDFDocumentLoadingTask.destroy() exists). Calling `.destroy` on the
 * resolved document directly throws "destroy is not a function" --
 * previously latent here because the modal viewer never unmounted while
 * a document was genuinely loaded (closing it set documentId to null
 * BEFORE any unmount); embedding the viewer directly on a page (0101)
 * unmounts it on every route change, which reliably triggers this
 * cleanup path and crashed real navigation from the viewer to the edit
 * page. Mirrors rasterize-pdf.ts's own openPdfjsDocument, which already
 * gets this right by keeping the loading task's destroy separate from
 * the resolved document.
 */
export type PdfjsDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfjsPage>;
  destroy: () => Promise<void>;
};

let workerSrcConfigured = false;

/** Loads a PDF from raw bytes already in memory. Caller owns calling `doc.destroy()` when finished. */
export async function loadLegislationPdf(bytes: Uint8Array): Promise<PdfjsDocument> {
  const pdfjs = (await import("pdfjs-dist")) as unknown as {
    getDocument: (opts: unknown) => {
      promise: Promise<{ numPages: number; getPage: (pageNumber: number) => Promise<PdfjsPage> }>;
      destroy: () => Promise<void>;
    };
    GlobalWorkerOptions: { workerSrc: string };
  };
  if (!workerSrcConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    workerSrcConfigured = true;
  }
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    verbosity: 0,
    cMapUrl: "/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/standard_fonts/",
  });
  const proxy = await loadingTask.promise;
  return {
    numPages: proxy.numPages,
    getPage: (pageNumber) => proxy.getPage(pageNumber),
    destroy: () => loadingTask.destroy(),
  };
}

/** Normalizes a pdfjs text-content item into the shape this viewer needs, dropping marked-content items that carry no string. */
export function normalizeTextItems(items: unknown[]): PdfjsTextItem[] {
  const out: PdfjsTextItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown };
    if (typeof item.str !== "string" || !item.str || !Array.isArray(item.transform)) continue;
    out.push({
      str: item.str,
      transform: item.transform as number[],
      width: typeof item.width === "number" ? item.width : 0,
      height: typeof item.height === "number" ? item.height : 0,
    });
  }
  return out;
}

/** Aggregate character count below which a document is treated as having no meaningful text layer — mirrors pdf-text-extraction.ts's own per-page MIN_CONFIDENT_CHARS (80), applied document-wide since this is a whole-document "is this searchable at all" signal. */
export const MIN_DOCUMENT_TEXT_CHARS = 80;
