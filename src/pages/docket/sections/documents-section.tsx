import { useRef, useState } from "react";
import { FileText, Upload, Trash2 } from "lucide-react";
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
import {
  useDeleteDocument,
  useDocuments,
  useUploadDocument,
} from "@/hooks/docket/use-docket-documents";
import { formatDate } from "@/lib/utils";
import type { Document } from "@/types/database.types";

interface DocumentsSectionProps {
  matterId: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsSection({ matterId }: DocumentsSectionProps) {
  const { data, isPending, isError, error, refetch } = useDocuments(
    "docket_matter",
    matterId,
  );
  const upload = useUploadDocument("docket_matter", matterId);
  const del = useDeleteDocument("docket_matter", matterId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingDelete, setPendingDelete] = useState<Document | null>(null);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex justify-end">
        <input
          ref={fileInputRef}
          type="file"
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

      {isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents attached"
          description="Upload PDFs, images, or Word documents relevant to this matter."
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
            {data.map((doc) => (
              <TableRow key={doc.id}>
                <TableCell className="font-medium text-foreground">
                  {doc.file_name}
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
                    aria-label={`Delete ${doc.file_name}`}
                    onClick={() => setPendingDelete(doc)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
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
    </div>
  );
}
