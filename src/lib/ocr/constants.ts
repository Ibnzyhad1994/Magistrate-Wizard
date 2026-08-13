/** Raster scale ≈ 300 DPI (PDF user space is 72 DPI). */
export const OCR_RENDER_SCALE = 300 / 72

/** Hard cap so a 400-page scan cannot freeze the admin tab. */
export const MAX_OCR_PAGES = 40

/** Tesseract mean-confidence (0-100) below which we refuse to treat OCR as usable. */
export const MIN_OCR_MEAN_CONFIDENCE = 45

/** Below this, even a quality-gate pass is labelled low_quality. */
export const LOW_OCR_MEAN_CONFIDENCE = 70
