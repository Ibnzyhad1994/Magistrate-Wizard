import { useEffect, useState } from "react"
import { Download, FileQuestion } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { LoadingSpinner } from "@/components/common/loading-spinner"
import { InlineError } from "@/components/common/inline-error"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  downloadDocumentBlob,
  findDocxPreviewDerivative,
  generateAndCacheDocxPreview,
  getDocumentViewUrl,
} from "@/hooks/use-documents"
import {
  getDocumentPreviewKind,
  isLegacyWordDocument,
} from "@/lib/document-preview"
import { sanitizePreviewHtml, wrapDocxPagePreviewSrcDoc, wrapSanitizedPreviewSrcDoc } from "@/lib/html-sanitize"
import { markdownToSafeHtml } from "@/lib/markdown-preview"
import type { Document } from "@/types/database.types"

interface DocumentViewerDialogProps {
  document: Document | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDownload: (doc: Document) => void
}

type PreviewContent =
  | { mode: "url" }
  | { mode: "html"; html: string }
  | { mode: "docx-pages"; html: string }
  | { mode: "text"; text: string }

export const DocumentViewerDialog = ({
  document: doc,
  open,
  onOpenChange,
  onDownload,
}: DocumentViewerDialogProps) => {
  const [url, setUrl] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewContent | null>(null)
  const [loading, setLoading] = useState(false)
  // Distinct from `loading` -- true only while an actual DOCX->page-preview
  // conversion is running (no cached derivative existed yet), so the UI can
  // say "Preparing document preview…" instead of a bare spinner. A cached
  // derivative is just a normal fetch and uses the ordinary loading state.
  const [preparing, setPreparing] = useState(false)
  const [loadError, setLoadError] = useState<unknown>(null)

  const kind = doc ? getDocumentPreviewKind(doc.mime_type, doc.file_name) : "unsupported"
  const isLegacyWord = doc ? isLegacyWordDocument(doc.mime_type, doc.file_name) : false

  const loadPreview = async (source: Document, fileKind: typeof kind) => {
    if (fileKind === "pdf" || fileKind === "image") {
      // A short-lived (60s) signed URL, not a blob: object URL — see
      // getDocumentViewUrl's own comment for why. Nothing to revoke; it
      // just expires on its own.
      const previewUrl = await getDocumentViewUrl(source.file_path)
      return { previewUrl, content: { mode: "url" as const } }
    }
    if (fileKind === "docx") {
      // Faithful, page-based preview (docx-preview), not mammoth's
      // semantic-HTML text extraction — see docx-page-preview.ts. Reuse a
      // cached derivative if one already exists; only pay the (client-
      // side, in-browser) conversion cost the first time anyone opens
      // this specific document.
      const derivative = await findDocxPreviewDerivative(source.id)
      if (derivative) {
        const blob = await downloadDocumentBlob(derivative.file_path)
        return { previewUrl: null, content: { mode: "docx-pages" as const, html: await blob.text() } }
      }
      setPreparing(true)
      try {
        const html = await generateAndCacheDocxPreview(source)
        return { previewUrl: null, content: { mode: "docx-pages" as const, html } }
      } catch (err) {
        console.error("DOCX preview generation failed:", err)
        throw new Error(
          "Could not generate a faithful preview of this document. The original file is unaffected — download it to view it in Word.",
        )
      } finally {
        setPreparing(false)
      }
    }
    const blob = await downloadDocumentBlob(source.file_path)
    const buffer = await blob.arrayBuffer()
    const text = new TextDecoder("utf-8").decode(buffer)
    if (fileKind === "markdown") {
      return {
        previewUrl: null,
        content: { mode: "html" as const, html: sanitizePreviewHtml(markdownToSafeHtml(text)) },
      }
    }
    return { previewUrl: null, content: { mode: "text" as const, text } }
  }

  useEffect(() => {
    if (!open || !doc || kind === "unsupported") {
      setUrl(null)
      setPreview(null)
      setLoadError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    loadPreview(doc, kind)
      .then((result) => {
        if (cancelled) return
        setUrl(result.previewUrl)
        setPreview(result.content)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // Re-fetch whenever a different document is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc?.id])

  const handleRetry = () => {
    if (!doc || kind === "unsupported") return
    setLoading(true)
    setLoadError(null)
    loadPreview(doc, kind)
      .then((result) => {
        setUrl(result.previewUrl)
        setPreview(result.content)
      })
      .catch(setLoadError)
      .finally(() => setLoading(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-full max-w-4xl flex-col gap-3 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{doc?.file_name ?? "Document"}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-muted/20">
          {!doc ? null : kind === "unsupported" ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <FileQuestion className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {isLegacyWord
                    ? "Preview isn't available for Word 97–2003 (.doc) files"
                    : "Preview isn't available for this file type"}
                </p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  {isLegacyWord
                    ? "Save a copy as .docx to preview it here, or download the original to open it in Word."
                    : "Download the original file to open it."}
                </p>
              </div>
              <Button size="sm" onClick={() => onDownload(doc)}>
                <Download className="h-4 w-4" />
                Download original
              </Button>
            </div>
          ) : loading && preparing ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <LoadingSpinner size={24} />
              <p className="text-sm text-muted-foreground">Preparing document preview…</p>
            </div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center">
              <LoadingSpinner size={24} />
            </div>
          ) : loadError ? (
            <div className="p-6">
              <InlineError error={loadError} onRetry={handleRetry} />
            </div>
          ) : url && kind === "pdf" ? (
            <iframe src={url} title={doc.file_name} className="h-full w-full" />
          ) : url && kind === "image" ? (
            <div className="flex h-full w-full items-center justify-center overflow-auto p-4">
              <img src={url} alt={doc.file_name} className="max-h-full max-w-full object-contain" />
            </div>
          ) : preview?.mode === "docx-pages" ? (
            <iframe
              title={`Preview of ${doc.file_name}`}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={wrapDocxPagePreviewSrcDoc(preview.html)}
              className="h-full w-full border-0 bg-transparent"
            />
          ) : preview?.mode === "html" ? (
            <iframe
              title={`Preview of ${doc.file_name}`}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={wrapSanitizedPreviewSrcDoc(preview.html)}
              className="h-full w-full border-0 bg-transparent"
            />
          ) : preview?.mode === "text" ? (
            <ScrollArea className="h-full">
              <pre
                aria-label={`Text of ${doc.file_name}`}
                className="whitespace-pre-wrap break-words p-6 font-sans text-sm leading-relaxed text-foreground"
              >
                {preview.text}
              </pre>
            </ScrollArea>
          ) : null}
        </div>

        {doc && kind !== "unsupported" && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => onDownload(doc)}>
              <Download className="h-4 w-4" />
              Download original
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
