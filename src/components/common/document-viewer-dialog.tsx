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
import { downloadDocumentBlob, getDocumentViewUrl } from "@/hooks/use-documents"
import {
  getDocumentPreviewKind,
  isLegacyWordDocument,
} from "@/lib/document-preview"
import { convertDocxToHtml } from "@/lib/docx-text-extraction"
import { sanitizePreviewHtml, wrapSanitizedPreviewSrcDoc } from "@/lib/html-sanitize"
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
  const [loadError, setLoadError] = useState<unknown>(null)

  const kind = doc ? getDocumentPreviewKind(doc.mime_type, doc.file_name) : "unsupported"
  const isLegacyWord = doc ? isLegacyWordDocument(doc.mime_type, doc.file_name) : false

  const loadPreview = async (filePath: string, fileKind: typeof kind) => {
    if (fileKind === "pdf" || fileKind === "image") {
      const objectUrl = await getDocumentViewUrl(filePath)
      return { objectUrl, content: { mode: "url" as const } }
    }
    const blob = await downloadDocumentBlob(filePath)
    const buffer = await blob.arrayBuffer()
    if (fileKind === "docx") {
      const rawHtml = await convertDocxToHtml(buffer)
      return { objectUrl: null, content: { mode: "html" as const, html: sanitizePreviewHtml(rawHtml) } }
    }
    const text = new TextDecoder("utf-8").decode(buffer)
    if (fileKind === "markdown") {
      return {
        objectUrl: null,
        content: { mode: "html" as const, html: sanitizePreviewHtml(markdownToSafeHtml(text)) },
      }
    }
    return { objectUrl: null, content: { mode: "text" as const, text } }
  }

  useEffect(() => {
    if (!open || !doc || kind === "unsupported") {
      setUrl(null)
      setPreview(null)
      setLoadError(null)
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    setLoading(true)
    setLoadError(null)
    loadPreview(doc.file_path, kind)
      .then((result) => {
        if (cancelled) {
          if (result.objectUrl) URL.revokeObjectURL(result.objectUrl)
          return
        }
        objectUrl = result.objectUrl
        setUrl(result.objectUrl)
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
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // Re-fetch whenever a different document is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc?.id])

  const handleRetry = () => {
    if (!doc || kind === "unsupported") return
    setLoading(true)
    setLoadError(null)
    loadPreview(doc.file_path, kind)
      .then((result) => {
        setUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous)
          return result.objectUrl
        })
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
