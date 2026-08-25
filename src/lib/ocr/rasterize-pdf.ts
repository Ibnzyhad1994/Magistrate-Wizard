/**
 * Rasterize PDF pages to PNG bytes via pdf.js — the accurate OCR input
 * path for scanned pages, CID-font pages this project's text-layer parser
 * cannot decode, and mixed documents.
 *
 * Browser: HTMLCanvasElement (DOM). Worker script is served from /pdf.worker.min.mjs.
 * Node tests: pdf.js legacy build + NodeCanvasFactory (@napi-rs/canvas).
 *
 * Text extraction (extractPdfjsTextContent) is the PRIMARY born-digital
 * extractor. It does not inherit the OCR page cap.
 */

import { isAbortError, throwIfAborted, withTimeout } from "@/lib/async-timeout"
import {
  MAX_OCR_PAGES,
  OCR_RENDER_SCALE,
  PDFJS_OPEN_TIMEOUT_MS,
  PDFJS_PAGE_TIMEOUT_MS,
} from "@/lib/ocr/constants"
import type { PdfPageResult } from "@/lib/pdf-text-extraction"

export interface RasterPage {
  pageNumber: number
  png: Uint8Array
}

export type PdfjsOpenFailure = "need_password" | "open_failed" | "aborted" | "timeout"

export type PdfjsTextExtraction =
  | {
      ok: true
      text: string
      pages: PdfPageResult[]
      pageCount: number
      truncated: boolean
      warnings: string[]
    }
  | {
      ok: false
      reason: PdfjsOpenFailure
    }

type PdfjsModule = {
  getDocument: (opts: unknown) => { promise: Promise<unknown>; destroy: () => Promise<unknown> }
  GlobalWorkerOptions: { workerSrc: string }
}

let workerSrcConfigured = false

const loadPdfjs = async (): Promise<PdfjsModule> => {
  if (typeof window === "undefined") {
    return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule
  }
  const pdfjs = (await import("pdfjs-dist")) as unknown as PdfjsModule
  if (!workerSrcConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"
    workerSrcConfigured = true
  }
  return pdfjs
}

const canvasToPng = async (canvas: {
  toBlob?: (cb: (blob: Blob | null) => void, type?: string) => void
  toBuffer?: (mime?: string) => Buffer
  convertToBlob?: (opts: { type: string }) => Promise<Blob>
}): Promise<Uint8Array> => {
  if (typeof canvas.toBuffer === "function") {
    return new Uint8Array(canvas.toBuffer("image/png"))
  }
  if (typeof canvas.convertToBlob === "function") {
    const blob = await canvas.convertToBlob({ type: "image/png" })
    return new Uint8Array(await blob.arrayBuffer())
  }
  if (typeof canvas.toBlob === "function") {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob!((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))), "image/png")
    })
    return new Uint8Array(await blob.arrayBuffer())
  }
  throw new Error("No canvas PNG encoder available in this environment.")
}

export const classifyPdfjsOpenError = (error: unknown): PdfjsOpenFailure => {
  if (isAbortError(error)) return "aborted"
  if (error && typeof error === "object" && "name" in error) {
    const name = String((error as { name: unknown }).name)
    if (name === "TimeoutError") return "timeout"
    if (name === "PasswordException") return "need_password"
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code
    if (code === 1 || code === 2) return "need_password"
  }
  return "open_failed"
}

const nodePdfjsAssetUrls = () => {
  const root = process.cwd().replace(/\\/g, "/")
  const prefix = root.startsWith("/") ? `file://${root}` : `file:///${root}`
  return {
    cMapUrl: `${prefix}/public/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${prefix}/public/standard_fonts/`,
  }
}

const pdfjsDocumentOptions = (data: Uint8Array) => ({
  data,
  verbosity: 0,
  disableAutoFetch: true,
  disableStream: true,
  ...(typeof window !== "undefined"
    ? { cMapUrl: "/cmaps/", cMapPacked: true, standardFontDataUrl: "/standard_fonts/" }
    : nodePdfjsAssetUrls()),
})

type PdfjsDocument = {
  numPages: number
  getPage: (n: number) => Promise<{
    getViewport: (opts: { scale: number }) => { width: number; height: number }
    render: (opts: {
      canvasContext: CanvasRenderingContext2D
      viewport: { width: number; height: number }
      canvas: HTMLCanvasElement
    }) => { promise: Promise<unknown> }
    getTextContent: () => Promise<{ items: Array<{ str?: unknown }> }>
    cleanup: () => void
  }>
  cleanup: () => Promise<unknown> | unknown
  destroy?: () => Promise<unknown>
  canvasFactory?: unknown
}

const openPdfjsDocument = async (
  file: File,
  signal?: AbortSignal,
): Promise<{ pdf: PdfjsDocument; destroy: () => Promise<void> }> => {
  throwIfAborted(signal)
  const pdfjs = await loadPdfjs()
  const data = new Uint8Array(await file.arrayBuffer())
  throwIfAborted(signal)
  const loadingTask = pdfjs.getDocument(pdfjsDocumentOptions(data))
  const destroy = async () => {
    try {
      await loadingTask.destroy()
    } catch {
      // Best-effort — a timed-out worker may already be gone.
    }
  }
  try {
    const pdf = (await withTimeout(
      loadingTask.promise,
      PDFJS_OPEN_TIMEOUT_MS,
      "Timed out opening this PDF with the renderer.",
    )) as unknown as PdfjsDocument
    return { pdf, destroy }
  } catch (error) {
    await destroy()
    throw error
  }
}

export interface RasterizePdfOptions {
  maxPages?: number
  signal?: AbortSignal
}

export const rasterizePdfPages = async (
  file: File,
  maxPagesOrOptions: number | RasterizePdfOptions = MAX_OCR_PAGES,
): Promise<RasterPage[]> => {
  const options: RasterizePdfOptions =
    typeof maxPagesOrOptions === "number" ? { maxPages: maxPagesOrOptions } : maxPagesOrOptions
  const maxPages = options.maxPages ?? MAX_OCR_PAGES
  const { pdf, destroy } = await openPdfjsDocument(file, options.signal)
  try {
    const pageCount = Math.min(pdf.numPages, maxPages)
    const pages: RasterPage[] = []

    for (let i = 1; i <= pageCount; i++) {
      throwIfAborted(options.signal)
      const page = await withTimeout(
        pdf.getPage(i),
        PDFJS_PAGE_TIMEOUT_MS,
        `Timed out loading page ${i} for recognition.`,
      )
      const viewport = page.getViewport({ scale: OCR_RENDER_SCALE })
      const width = Math.ceil(viewport.width)
      const height = Math.ceil(viewport.height)

      if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Could not create a 2D canvas context for PDF rasterization.")
        await withTimeout(
          page.render({
            canvasContext: context,
            viewport,
            canvas,
          }).promise,
          PDFJS_PAGE_TIMEOUT_MS,
          `Timed out rendering page ${i} for recognition.`,
        )
        pages.push({ pageNumber: i, png: await canvasToPng(canvas) })
        page.cleanup()
        continue
      }

      const factory = pdf.canvasFactory as {
        create: (w: number, h: number) => {
          canvas: { toBuffer?: (mime?: string) => Buffer }
          context: CanvasRenderingContext2D
        }
      }
      const created = factory.create(width, height)
      await withTimeout(
        page.render({
          canvasContext: created.context,
          viewport,
          canvas: created.canvas as unknown as HTMLCanvasElement,
        }).promise,
        PDFJS_PAGE_TIMEOUT_MS,
        `Timed out rendering page ${i} for recognition.`,
      )
      pages.push({ pageNumber: i, png: await canvasToPng(created.canvas) })
      page.cleanup()
    }

    await pdf.cleanup()
    return pages
  } finally {
    await destroy()
  }
}

export interface ExtractPdfjsTextOptions {
  signal?: AbortSignal
  /** If set, only this many pages are read and a warning is recorded. Never defaults to the OCR cap. */
  maxPages?: number
}

/**
 * pdf.js object-graph text layer — PRIMARY extractor for born-digital PDFs.
 * Handles CID/Type0 fonts, ASCIIHex/ASCII85 filters, and Form XObject text.
 * Returns need_password when a user password is required; owner-password-only
 * files open with an empty password and are extracted.
 */
export const extractPdfjsTextContent = async (
  file: File,
  options?: ExtractPdfjsTextOptions,
): Promise<PdfjsTextExtraction> => {
  try {
    const { pdf, destroy } = await openPdfjsDocument(file, options?.signal)
    try {
      const totalPages = pdf.numPages
      const truncated = typeof options?.maxPages === "number" && totalPages > options.maxPages
      const pageCount = truncated ? (options?.maxPages as number) : totalPages
      const warnings: string[] = []
      if (truncated) {
        warnings.push(
          `Only the first ${pageCount} of ${totalPages} pages were read for text — paste any remaining pages manually if needed.`,
        )
      }
      const pages: PdfPageResult[] = []
      for (let i = 1; i <= pageCount; i++) {
        throwIfAborted(options?.signal)
        const page = await withTimeout(
          pdf.getPage(i),
          PDFJS_PAGE_TIMEOUT_MS,
          `Timed out reading text from page ${i}.`,
        )
        const content = await withTimeout(
          page.getTextContent(),
          PDFJS_PAGE_TIMEOUT_MS,
          `Timed out reading text from page ${i}.`,
        )
        const line = content.items
          .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
          .filter(Boolean)
          .join(" ")
          .replace(/[ \t]{2,}/g, " ")
          .trim()
        pages.push({ pageNumber: i, text: line, characterCount: line.length })
        page.cleanup()
      }
      await pdf.cleanup()
      const text = pages
        .map((p) => p.text)
        .filter((t) => t.trim())
        .join("\n\n")
      return { ok: true, text, pages, pageCount: totalPages, truncated, warnings }
    } finally {
      await destroy()
    }
  } catch (error) {
    return { ok: false, reason: classifyPdfjsOpenError(error) }
  }
}
