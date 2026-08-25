/**
 * Shared Tesseract worker — one engine for the whole admin session so
 * bulk import does not spawn a worker (and a WASM heap) per file.
 * Recognize calls are serialized; the WASM worker is not safe to run
 * two pages at once.
 *
 * Browser / slow-machine notes:
 * - OCR runs entirely in-tab (WASM Web Worker), not on a server.
 * - Pages are processed one at a time through `recognizeQueue`.
 * - After each page, we yield to the event loop so the UI can paint.
 * - Corrupt images terminate and drop the worker so the next file can
 *   rebuild a clean engine instead of inheriting a poisoned WASM heap.
 */

import * as TesseractNS from "tesseract.js"
import { isAbortError, throwIfAborted, withTimeout } from "@/lib/async-timeout"
import { DEFAULT_OCR_PSM, OCR_RECOGNIZE_TIMEOUT_MS } from "@/lib/ocr/constants"

type OcrWorker = {
  setParameters: (params: Record<string, string>) => Promise<unknown>
  recognize: (image: unknown) => Promise<{ data: { text?: string; confidence?: number } }>
  terminate: () => Promise<unknown>
}

type TesseractApi = {
  createWorker: (
    langs?: string,
    oem?: number,
    options?: Record<string, unknown>,
  ) => Promise<OcrWorker>
  PSM: { SINGLE_COLUMN: string; AUTO?: string; SPARSE_TEXT?: string }
}

const Tesseract = ((TesseractNS as { default?: TesseractApi }).default ?? TesseractNS) as TesseractApi

type RecognizeInput = Buffer | Blob | Uint8Array | string

interface OcrPageResult {
  text: string
  confidence: number
}

let workerPromise: Promise<OcrWorker> | null = null
let activeWorker: OcrWorker | null = null
let recognizeQueue: Promise<unknown> = Promise.resolve()

const workerOptions = (): Record<string, unknown> => {
  if (typeof window === "undefined") {
    return { gzip: true }
  }
  return {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract",
    langPath: "/tesseract",
    gzip: true,
    workerBlobURL: false,
  }
}

const getWorker = async (): Promise<OcrWorker> => {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await Tesseract.createWorker("eng", 1, workerOptions())
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.AUTO ?? DEFAULT_OCR_PSM,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
        tessedit_do_invert: "0",
      })
      activeWorker = worker
      return worker
    })().catch((err: unknown) => {
      workerPromise = null
      activeWorker = null
      throw err
    })
  }
  return workerPromise
}

/**
 * Tear down the shared worker. Corrupt JPEG/PNG decode can leave the WASM
 * heap unusable; dropping it lets the next recognize rebuild cleanly.
 */
export const terminateOcrWorker = async (): Promise<void> => {
  const worker = activeWorker
  activeWorker = null
  workerPromise = null
  if (!worker) return
  try {
    await worker.terminate()
  } catch {
    // Best-effort — a poisoned worker may reject terminate.
  }
}

export const recognizeImage = (image: RecognizeInput, signal?: AbortSignal): Promise<OcrPageResult> => {
  const run = async (): Promise<OcrPageResult> => {
    throwIfAborted(signal)
    const worker = await getWorker()
    try {
      const { data } = await withTimeout(
        worker.recognize(image),
        OCR_RECOGNIZE_TIMEOUT_MS,
        "Timed out recognizing text on this page.",
      )
      throwIfAborted(signal)
      return { text: data.text ?? "", confidence: data.confidence ?? 0 }
    } catch (err) {
      if (isAbortError(err)) throw err
      await terminateOcrWorker()
      throw err
    }
  }
  const result = recognizeQueue.then(run, run)
  recognizeQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

/** Yield so the browser can paint / handle input between heavy OCR pages. */
export const yieldForUi = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => setTimeout(resolve, 0))
      return
    }
    setTimeout(resolve, 0)
  })

export const isOcrEngineAvailable = async (): Promise<boolean> => {
  try {
    await getWorker()
    return true
  } catch {
    return false
  }
}
