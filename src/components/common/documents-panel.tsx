import { useRef, useState } from "react";
import { FileText, Upload, Trash2, Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { DocumentViewerDialog } from "@/components/common/document-viewer-dialog";
import {
  getDocumentDownloadUrl,
  useDeleteDocument,
  useDocuments,
  useUploadDocument,
} from "@/hooks/use-documents";
import { useAuth } from "@/hooks/use-auth";
import { getErrorMessage } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";
import { INGEST_FILE_ACCEPT } from "@/lib/ingest-source";
import type { Document } from "@/types/database.types";

interface DocumentsPanelProps {
  /** One of the six approved polymorphic parent types. */
  entityType: "docket_matter" | "judgment" | "case_law" | "quick_code" | "bench_note";
  entityId: string;
  /**
   * Whether the caller is currently allowed to attach documents here per
   * the live `documents` INSERT policy (e.g. canonical Case Law can only
   * be attached to by an admin — a personal-research owner or a
   * discoverable-research viewer cannot). Defaults to true for parent
   * types where the page context already guarantees edit access (a
   * magistrate's own Quick Codes/Bench Notes, for instance). When false,
   * the Upload control is hidden rather than shown-then-denied by RLS.
   */
  canUpload?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Shared attachment UI for every polymorphic Document parent — see
 * `src/hooks/use-documents.ts` for the underlying upload/list/delete
 * logic (Storage-API-first deletion order, orphan cleanup on partial
 * upload failure). One implementation instead of duplicating this
 * across Docket/Judgment/Case Law/Quick Code/Bench Note detail pages.
 */
export function DocumentsPanel({ entityType, entityId, canUpload = true }: DocumentsPanelProps) {
  const { user } = useAuth();
  const { data, isPending, isError, error, refetch } = useDocuments(entityType, entityId);
  const upload = useUploadDocument(entityType, entityId);
  const del = useDeleteDocument(entityType, entityId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingDelete, setPendingDelete] = useState<Document | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [viewingDoc, setViewingDoc] = useState<Document | null>(null);
  const visibleDocs = (data ?? []).filter(
    (doc) => doc.purpose !== "identification_photo" && doc.purpose !== "cover",
  );

  async function handleDownload(doc: Document) {
    setDownloadingId(doc.id);
    try {
      const url = await getDocumentDownloadUrl(doc.file_path);
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.file_name || "document";
      link.rel = "noopener";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      {canUpload && (
        <div className="flex justify-end">
          <input
            ref={fileInputRef}
            type="file"
            accept={INGEST_FILE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={upload.isPending}
          >
            {upload.isPending ? (
              <LoadingSpinner className="text-current" size={16} />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Upload document
          </Button>
        </div>
      )}

      {isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : !visibleDocs || visibleDocs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents attached"
          description={
            canUpload
              ? "Upload PDFs, Word documents, Markdown, text files, or images relevant to this record."
              : "Nothing has been attached here."
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Uploaded</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleDocs.map((doc) => (
              <TableRow key={doc.id}>
                <TableCell className="font-medium text-foreground">
                  <button
                    type="button"
                    onClick={() => setViewingDoc(doc)}
                    className="truncate text-left hover:underline"
                    title="Open"
                    aria-label={`View ${doc.file_name}`}
                  >
                    {doc.file_name}
                  </button>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatBytes(doc.file_size)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(doc.created_at)}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`View ${doc.file_name}`}
                    onClick={() => setViewingDoc(doc)}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Download ${doc.file_name}`}
                    disabled={downloadingId === doc.id}
                    onClick={() => void handleDownload(doc)}
                  >
                    {downloadingId === doc.id ? (
                      <LoadingSpinner size={16} />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </Button>
                  {doc.uploaded_by === user?.id && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${doc.file_name}`}
                      onClick={() => setPendingDelete(doc)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this document?"
        description={
          pendingDelete
            ? `"${pendingDelete.file_name}" will be permanently removed from storage. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        isConfirming={del.isPending}
        onConfirm={() => {
          if (pendingDelete) {
            del.mutate(
              { id: pendingDelete.id, file_path: pendingDelete.file_path },
              { onSuccess: () => setPendingDelete(null) },
            );
          }
        }}
      />

      <DocumentViewerDialog
        document={viewingDoc}
        open={!!viewingDoc}
        onOpenChange={(open) => !open && setViewingDoc(null)}
        onDownload={(d) => void handleDownload(d)}
      />
    </div>
  );
}
