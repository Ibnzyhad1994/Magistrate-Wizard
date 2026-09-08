import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import {
  calloverReportFileName,
  generateCalloverReportPdf,
  type CalloverReportRow,
} from "@/lib/callover-report-pdf";
import { calloverProgress } from "@/lib/callover";
import { getErrorMessage } from "@/lib/utils";
import type { CalloverRowData } from "@/pages/docket/callover/callover-row";

/**
 * Downloads the callover record. Generated entirely from rows already on
 * screen — no extra fetch, so the PDF is exactly the sheet the magistrate
 * is looking at, and it works the moment the last outcome is recorded.
 */
export function CalloverReportButton({
  callover,
  rows,
  title,
}: {
  callover: { callover_date: string; courts?: { name: string | null } | null };
  rows: CalloverRowData[];
  title: string;
}) {
  const { profile } = useAuth();

  function onGenerate() {
    try {
      const courtName = callover.courts?.name ?? null;
      const progress = calloverProgress(rows);
      const doc = generateCalloverReportPdf(rows as unknown as CalloverReportRow[], {
        title,
        dateLabel: new Date(`${callover.callover_date}T00:00:00`).toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        courtName,
        magistrateName: profile?.full_name ?? null,
        generatedAtLabel: new Date().toLocaleString(),
        calledCount: progress.called,
        totalCount: progress.total,
      });
      doc.save(calloverReportFileName(callover.callover_date, courtName));
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={onGenerate}>
      <FileDown className="h-4 w-4" />
      Callover record
    </Button>
  );
}
