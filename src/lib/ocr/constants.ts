/** Raster scale ≈ 300 DPI (PDF user space is 72 DPI). */
export const OCR_RENDER_SCALE = 300 / 72

/** Hard cap so a 400-page scan cannot freeze the admin tab. Applies to OCR rasterization only — never to born-digital text extraction. */
export const MAX_OCR_PAGES = 40

/** pdf.js getDocument / page open. A hung worker must not stall the batch. */
export const PDFJS_OPEN_TIMEOUT_MS = 30_000

/** pdf.js getTextContent / page.render per page. */
export const PDFJS_PAGE_TIMEOUT_MS = 20_000

/** Tesseract worker.recognize per page. On timeout the shared worker is torn down and rebuilt. */
export const OCR_RECOGNIZE_TIMEOUT_MS = 120_000

/** Optional first-pages pass so a running title can fill metadata while the rest is pasted. */
export const OCR_METADATA_PAGES = 3

/** Tesseract page segmentation — AUTO, not single-column (WIR scans are two-column). */
export const DEFAULT_OCR_PSM = "3"

/** Tesseract mean-confidence (0-100) below which we refuse to treat OCR as usable. */
export const MIN_OCR_MEAN_CONFIDENCE = 45

/** Below this, even a quality-gate pass is labelled low_quality. */
export const LOW_OCR_MEAN_CONFIDENCE = 70
