import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { useDailyDocketReportData } from "@/hooks/docket/use-daily-docket-report";
import { generateDailyDocketReportPdf, reportFileName } from "@/lib/docket-report-pdf";
import { useAuth } from "@/hooks/use-auth";
import { getErrorMessage } from "@/lib/utils";

/**
 * "Generate Daily Progress Report" — fetches get_daily_docket_report_data
 * for the selected date (the same date-specific appearance data the
 * on-screen Docket list already uses, see docket-report-pdf.ts's header
 * comment) and downloads a PDF. Only shown once a date is selected — the
 * report is inherently date-specific (Part I/section 33), never "current
 * Next Date across all matters".
 *
 * `courtId` (0097) carries the two-level Docket's current scope into the
 * export: generated from a specific court's Docket view, the report is
 * limited to that exact court_id; generated from All My Courts, it
 * spans every authorized court for that date (each row still carries its
 * own court_name, exactly like the on-screen combined view).
 */
export function DailyProgressReportButton({ date, courtId }: { date: string; courtId: string | null }) {
  const { profile } = useAuth();
  const fetchReport = useDailyDocketReportData();

  async function onGenerate() {
    try {
      const rows = await fetchReport.mutateAsync({ date, courtId });
      if (rows.length === 0) {
        toast.error("No matters scheduled for this date — nothing to report.");
        return;
      }
      const courtNames = new Set(rows.map((r) => r.court_name).filter(Boolean));
      const districtNames = new Set(rows.map((r) => r.district_name).filter(Boolean));
      const courtName = courtNames.size === 1 ? ([...courtNames][0] as string) : null;
      const districtName = districtNames.size === 1 ? ([...districtNames][0] as string) : null;

      const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      });

      const doc = generateDailyDocketReportPdf(rows, {
        dateLabel,
        courtName,
        districtName,
        magistrateName: profile?.full_name ?? null,
        generatedAtLabel: new Date().toLocaleString(),
      });
      doc.save(reportFileName(date, courtName));
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={() => void onGenerate()} disabled={fetchReport.isPending}>
      {fetchReport.isPending ? <LoadingSpinner size={14} /> : <FileDown className="h-4 w-4" />}
      Generate Daily Progress Report
    </Button>
  );
}
