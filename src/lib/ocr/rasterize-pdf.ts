/**
 * Rasterize PDF pages to PNG bytes via pdf.js — the accurate OCR input
 * path for scanned pages, CID-font pages this project's text-layer parser
 * cannot decode, and mixed documents.
 *
 * Browser: HTMLCanvasElement (DOM). Worker script is served from /pdf.worker.min.mjs.
 * Node tests: pdf.js legacy build + NodeCanvasFactory (@napi-rs/canvas).
 */

import { MAX_OCR_PAGES, OCR_RENDER_SCALE } from "@/lib/ocr/constants"
import type { PdfPageResult } from "@/lib/pdf-text-extraction"

export interface RasterPage {
  pageNumber: number
  png: Uint8Array
}

type PdfjsModule = typeof import("pdfjs-dist")

let workerSrcConfigured = false

const loadPdfjs = async (): Promise<PdfjsModule> => {
  if (typeof window === "undefined") {
    return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule
  }
  const pdfjs = await import("pdfjs-dist")
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

export const rasterizePdfPages = async (file: File, maxPages = MAX_OCR_PAGES): Promise<RasterPage[]> => {
  const pdfjs = await loadPdfjs()
  const data = new Uint8Array(await file.arrayBuffer())
  const loadingTask = pdfjs.getDocument(pdfjsDocumentOptions(data))
  const pdf = await loadingTask.promise
  const pageCount = Math.min(pdf.numPages, maxPages)
  const pages: RasterPage[] = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: OCR_RENDER_SCALE })
    const width = Math.ceil(viewport.width)
    const height = Math.ceil(viewport.height)

    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext("2d")
      if (!context) throw new Error("Could not create a 2D canvas context for PDF rasterization.")
      await page.render({
        canvasContext: context,
        viewport,
        canvas,
      }).promise
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
    await page.render({
      canvasContext: created.context,
      viewport,
      canvas: created.canvas as unknown as HTMLCanvasElement,
    }).promise
    pages.push({ pageNumber: i, png: await canvasToPng(created.canvas) })
    page.cleanup()
  }

  await pdf.cleanup()
  return pages
}

const pdfjsDocumentOptions = (data: Uint8Array) => ({
  data,
  verbosity: 0,
  disableAutoFetch: true,
  disableStream: true,
  ...(typeof window !== "undefined"
    ? { cMapUrl: "/cmaps/", cMapPacked: true, standardFontDataUrl: "/standard_fonts/" }
    : {}),
})

/**
 * pdf.js object-graph text layer — used when the homemade parser cannot
 * decode CID/Type0 fonts. More accurate than OCR on born-digital CID PDFs.
 * Returns null when the file cannot be opened (encrypted, malformed).
 */
export const extractPdfjsTextContent = async (
  file: File,
): Promise<{ text: string; pages: PdfPageResult[] } | null> => {
  try {
    const pdfjs = await loadPdfjs()
    const data = new Uint8Array(await file.arrayBuffer())
    const pdf = await pdfjs.getDocument(pdfjsDocumentOptions(data)).promise
    const pageCount = Math.min(pdf.numPages, MAX_OCR_PAGES)
    const pages: PdfPageResult[] = []
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
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
    if (!text.trim()) return null
    return { text, pages }
  } catch {
    return null
  }
}
