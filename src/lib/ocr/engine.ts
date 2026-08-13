/**
 * Shared Tesseract worker — one engine for the whole admin session so
 * bulk import does not spawn a worker (and a WASM heap) per file.
 * Recognize calls are serialized; the WASM worker is not safe to run
 * two pages at once.
 */

import * as TesseractNS from "tesseract.js"

type TesseractApi = {
  createWorker: (
    langs?: string,
    oem?: number,
    options?: Record<string, unknown>,
  ) => Promise<{
    setParameters: (params: Record<string, string>) => Promise<unknown>
    recognize: (image: unknown) => Promise<{ data: { text?: string; confidence?: number } }>
  }>
  PSM: { SINGLE_COLUMN: string }
}

const Tesseract = ((TesseractNS as { default?: TesseractApi }).default ?? TesseractNS) as TesseractApi

type RecognizeInput = Buffer | Blob | Uint8Array | string

interface OcrPageResult {
  text: string
  confidence: number
}

type OcrWorker = Awaited<ReturnType<TesseractApi["createWorker"]>>

let workerPromise: Promise<OcrWorker> | null = null
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
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_COLUMN,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
        tessedit_do_invert: "0",
      })
      return worker
    })().catch((err: unknown) => {
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

export const recognizeImage = (image: RecognizeInput): Promise<OcrPageResult> => {
  const run = async (): Promise<OcrPageResult> => {
    const worker = await getWorker()
    const { data } = await worker.recognize(image)
    return { text: data.text ?? "", confidence: data.confidence ?? 0 }
  }
  const result = recognizeQueue.then(run, run)
  recognizeQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export const isOcrEngineAvailable = async (): Promise<boolean> => {
  try {
    await getWorker()
    return true
  } catch {
    return false
  }
}
