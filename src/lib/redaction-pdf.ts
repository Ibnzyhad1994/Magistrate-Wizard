import jsPDF from "jspdf"
import { boxesForPage, type RedactionBox } from "@/lib/redaction"

const BURN_SCALE = 2

type JsPdfCtor = typeof jsPDF

const PdfCtor = (
  typeof jsPDF === "function" ? jsPDF : (jsPDF as unknown as { jsPDF: JsPdfCtor }).jsPDF
) as JsPdfCtor

type PdfjsModule = {
  getDocument: (opts: unknown) => {
    promise: Promise<{
      numPages: number
      getPage: (n: number) => Promise<PdfjsPage>
      canvasFactory?: {
        create: (w: number, h: number) => {
          canvas: { toBuffer?: (mime?: string) => Buffer }
          context: CanvasRenderingContext2D
        }
      }
    }>
    destroy: () => Promise<unknown>
  }
  GlobalWorkerOptions: { workerSrc: string }
}

type PdfjsPage = {
  getViewport: (opts: { scale: number; rotation?: number }) => { width: number; height: number }
  render: (opts: {
    canvasContext: CanvasRenderingContext2D
    viewport: unknown
    canvas?: HTMLCanvasElement
  }) => { promise: Promise<unknown> }
  getTextContent: () => Promise<{ items: Array<{ str?: unknown }> }>
  cleanup: () => void
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

const loadPdfjs = async (): Promise<PdfjsModule> => {
  if (typeof window === "undefined") {
    return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule
  }
  const pdfjs = (await import("pdfjs-dist")) as unknown as PdfjsModule
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"
  return pdfjs
}

const canvasToPng = async (canvas: {
  toBlob?: (cb: (blob: Blob | null) => void, type?: string) => void
  toBuffer?: (mime?: string) => Buffer
  convertToBlob?: (opts: { type: string }) => Promise<Blob>
  toDataURL?: (type?: string) => string
}): Promise<Uint8Array> => {
  if (typeof canvas.toBuffer === "function") {
    return new Uint8Array(canvas.toBuffer("image/png"))
  }
  if (typeof canvas.convertToBlob === "function") {
    const blob = await canvas.convertToBlob({ type: "image/png" })
    return new Uint8Array(await blob.arrayBuffer())
  }
  if (typeof canvas.toDataURL === "function") {
    const url = canvas.toDataURL("image/png")
    const comma = url.indexOf(",")
    const b64 = comma >= 0 ? url.slice(comma + 1) : url
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(b64, "base64"))
    }
    const binary = atob(b64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
  if (typeof canvas.toBlob === "function") {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob!((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))), "image/png")
    })
    return new Uint8Array(await blob.arrayBuffer())
  }
  throw new Error("No canvas PNG encoder available in this environment.")
}

const pngToDataUrl = (png: Uint8Array): string => {
  if (typeof Buffer !== "undefined") {
    return `data:image/png;base64,${Buffer.from(png).toString("base64")}`
  }
  let binary = ""
  for (const byte of png) binary += String.fromCharCode(byte)
  return `data:image/png;base64,${btoa(binary)}`
}

const paintBoxes = (
  ctx: CanvasRenderingContext2D,
  boxes: RedactionBox[],
  width: number,
  height: number,
) => {
  ctx.fillStyle = "#000000"
  for (const box of boxes) {
    ctx.fillRect(box.x * width, box.y * height, box.width * width, box.height * height)
  }
}

/**
 * Rasterize each page, fill redaction boxes black, and embed the images in a
 * new PDF so the original text layer cannot be copied. Does not mutate `bytes`.
 */
export async function burnRedactedPdf(opts: {
  bytes: Uint8Array
  boxes: RedactionBox[]
  title?: string
}): Promise<Uint8Array> {
  const data = opts.bytes.slice()
  const pdfjs = await loadPdfjs()
  const isNode = typeof window === "undefined"
  const loadingTask = pdfjs.getDocument({
    data,
    verbosity: 0,
    disableAutoFetch: true,
    disableStream: true,
    ...(isNode
      ? nodePdfjsAssetUrls()
      : { cMapUrl: "/cmaps/", cMapPacked: true, standardFontDataUrl: "/standard_fonts/" }),
  })
  const pdf = await loadingTask.promise
  try {
    let doc: InstanceType<JsPdfCtor> | null = null
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: BURN_SCALE, rotation: 0 })
      const width = Math.ceil(viewport.width)
      const height = Math.ceil(viewport.height)
      const pageBoxes = boxesForPage(opts.boxes, pageNumber)
      let png: Uint8Array

      if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("Could not create a 2D canvas context for redaction.")
        await page.render({ canvasContext: ctx, viewport, canvas }).promise
        paintBoxes(ctx, pageBoxes, width, height)
        png = await canvasToPng(canvas)
      } else {
        const factory = pdf.canvasFactory
        if (!factory) throw new Error("PDF renderer has no canvas factory in Node.")
        const created = factory.create(width, height)
        await page.render({
          canvasContext: created.context,
          viewport,
          canvas: created.canvas as unknown as HTMLCanvasElement,
        }).promise
        paintBoxes(created.context, pageBoxes, width, height)
        png = await canvasToPng(created.canvas)
      }

      page.cleanup()
      const widthPt = viewport.width / BURN_SCALE
      const heightPt = viewport.height / BURN_SCALE
      if (!doc) {
        doc = new PdfCtor({ unit: "pt", format: [widthPt, heightPt] })
        if (opts.title) {
          doc.setProperties({ title: `Redacted ${opts.title}` })
        }
      } else {
        doc.addPage([widthPt, heightPt])
      }
      doc.addImage(pngToDataUrl(png), "PNG", 0, 0, widthPt, heightPt, undefined, "FAST")
    }
    if (!doc) throw new Error("This PDF has no pages.")
    const buf = doc.output("arraybuffer")
    return new Uint8Array(buf)
  } finally {
    await loadingTask.destroy()
  }
}

export function redactedPdfFileName(originalName: string): string {
  const base = originalName.replace(/\.pdf$/i, "") || "document"
  return `redacted-${base}.pdf`
}
