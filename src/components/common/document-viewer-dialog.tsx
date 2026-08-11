import { useEffect, useState } from "react";
import { Download, FileQuestion } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { InlineError } from "@/components/common/inline-error";
import { getDocumentViewUrl } from "@/hooks/use-documents";
import {
  getDocumentPreviewKind,
  isWordDocument,
} from "@/lib/document-preview";
import type { Document } from "@/types/database.types";

interface DocumentViewerDialogProps {
  document: Document | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload: (doc: Document) => void;
}

/**
 * In-app preview for a `documents` row, shared by every DocumentsPanel
 * consumer. Fetches a fresh, short-lived (5 minute) signed URL scoped to
 * this one document each time it opens — never a permanent/public URL —
 * via the same Storage RLS as downloading (`getDocumentViewUrl`, see
 * `src/hooks/use-documents.ts`). Renders PDFs and images in place; every
 * other file type (Word documents included — no server-side conversion
 * infrastructure exists in this project yet, see `document-preview.ts`)
 * falls back to a plain "not previewable yet" message with a Download
 * Original action, never a fake/broken preview.
 */
export function DocumentViewerDialog({
  document: doc,
  open,
  onOpenChange,
  onDownload,
}: DocumentViewerDialogProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  const kind = doc ? getDocumentPreviewKind(doc.mime_type) : "unsupported";
  const isWord = doc ? isWordDocument(doc.mime_type, doc.file_name) : false;

  useEffect(() => {
    if (!open || !doc || kind === "unsupported") {
      setUrl(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getDocumentViewUrl(doc.file_path)
      .then((signedUrl) => {
        if (!cancelled) setUrl(signedUrl);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-fetch whenever a different document is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc?.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-full max-w-4xl flex-col gap-3 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">
            {doc?.file_name ?? "Document"}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-muted/20">
          {!doc ? null : kind === "unsupported" ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <FileQuestion className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {isWord
                    ? "Preview isn't available for Word documents yet"
                    : "Preview isn't available for this file type"}
                </p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  {isWord
                    ? "The original file is preserved unchanged. Download it to read it in Word or a compatible viewer."
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
              <InlineError
                error={loadError}
                onRetry={() => {
                  if (!doc) return;
                  setLoading(true);
                  setLoadError(null);
                  getDocumentViewUrl(doc.file_path)
                    .then(setUrl)
                    .catch(setLoadError)
                    .finally(() => setLoading(false));
                }}
              />
            </div>
          ) : url && kind === "pdf" ? (
            <iframe src={url} title={doc.file_name} className="h-full w-full" />
          ) : url && kind === "image" ? (
            <div className="flex h-full w-full items-center justify-center overflow-auto p-4">
              <img
                src={url}
                alt={doc.file_name}
                className="max-h-full max-w-full object-contain"
              />
            </div>
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
  );
}
