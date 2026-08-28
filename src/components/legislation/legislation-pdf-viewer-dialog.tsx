import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { LegislationPdfViewer } from "@/components/legislation/legislation-pdf-viewer";

/**
 * Full-viewport modal wrapper around the read-only LegislationPdfViewer —
 * used where a modal preview makes more sense than a full page (the admin
 * edit page's "Preview current PDF" action). The default `/legislation/:id`
 * reading experience embeds LegislationPdfViewer directly on the page
 * instead of behind a dialog — see legislation-viewer-page.tsx.
 */
export function LegislationPdfViewerDialog({
  open,
  onOpenChange,
  documentId,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string | null;
  title: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="left-0 top-0 flex h-dvh w-dvw max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 sm:rounded-none"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {/* pr-12 keeps every toolbar control clear of DialogContent's own
            fixed-position close button (absolute right-4 top-4) -- without
            it, Print/Download sit directly under that button's hit area
            and never receive the click (confirmed live in the standalone
            dialog case this wrapper reproduces). */}
        <LegislationPdfViewer
          documentId={open ? documentId : null}
          title={title}
          className="h-full"
          toolbarClassName="pr-12"
        />
      </DialogContent>
    </Dialog>
  );
}
