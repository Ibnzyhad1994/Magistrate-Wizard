import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LegislationPdfUploadPanel } from "@/pages/admin/legislation-pdf-upload-panel";
import { ROUTES } from "@/routes/paths";

interface CreateLegislationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Create-and-publish a new Act from the Legislation browse page. Reuses
 * the file-first upload panel (code, title, jurisdiction, PDF, and the
 * optional metadata fields) rather than a second form. Replacement of an
 * existing Act still lives on the admin edit route.
 */
export function CreateLegislationDialog({ open, onOpenChange }: CreateLegislationDialogProps) {
  const navigate = useNavigate();

  const handleSuccess = (statuteId: string) => {
    onOpenChange(false);
    navigate(ROUTES.legislationDetail(statuteId));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add legislation</DialogTitle>
          <DialogDescription>
            Fill in the required details and upload the official PDF. It
            publishes immediately to the shared library.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <LegislationPdfUploadPanel onSuccess={handleSuccess} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
