import { useMemo, useState } from "react";
import { Bug, Lightbulb } from "lucide-react";
import { BrowseHeader, BrowsePage } from "@/components/browse";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { formatDateTime } from "@/lib/utils";
import {
  useIssueReports,
  useUpdateIssueReport,
  type IssueReportStatus,
} from "@/hooks/admin/use-issue-reports";

const STATUS_LABELS: Record<IssueReportStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  wont_fix: "Won't fix",
};

const STATUS_FILTERS = ["all", "open", "in_progress", "resolved", "wont_fix"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/**
 * Admin triage view for reports filed via the header "Report an issue"
 * button (see ReportIssueButton / 0103_issue_reports.sql). Everything
 * lives in this one Supabase table — no external tracker involved, so
 * this page is the entire lifecycle: file, triage, resolve.
 */
export default function IssueReportsAdminPage() {
  const { data: reports, isPending, isError, error, refetch } = useIssueReports();
  const updateReport = useUpdateIssueReport();
  const [filter, setFilter] = useState<StatusFilter>("open");

  const filtered = useMemo(() => {
    const rows = reports ?? [];
    return filter === "all" ? rows : rows.filter((r) => r.status === filter);
  }, [reports, filter]);

  return (
    <BrowsePage>
      <BrowseHeader
        title="Issue Reports"
        description="Bugs and suggestions filed by users from anywhere in the app."
      />

      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === s
                ? "border-primary bg-primary text-primary-foreground"
                : "border-white/15 text-white/70 hover:bg-white/5"
            }`}
          >
            {s === "all" ? "All" : STATUS_LABELS[s as IssueReportStatus]}
            {s !== "all" ? ` (${(reports ?? []).filter((r) => r.status === s).length})` : ""}
          </button>
        ))}
      </div>

      {isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Bug}
          title="Nothing here"
          description="No issue reports match this filter."
        />
      ) : (
        <div className="max-w-3xl space-y-3">
          {filtered.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {r.type === "bug" ? (
                      <Bug className="h-4 w-4 shrink-0 text-red-400" />
                    ) : (
                      <Lightbulb className="h-4 w-4 shrink-0 text-amber-300" />
                    )}
                    <p className="font-medium text-foreground">{r.title}</p>
                  </div>
                  <Badge variant={r.status === "open" ? "default" : "secondary"}>
                    {STATUS_LABELS[r.status]}
                  </Badge>
                </div>

                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {r.description}
                </p>

                <p className="text-xs text-muted-foreground">
                  {r.profiles?.full_name || r.profiles?.email || "Unknown reporter"}
                  {r.reporter_role ? ` · ${r.reporter_role}` : ""} · {formatDateTime(r.created_at)}
                  {r.page_path ? ` · ${r.page_path}` : ""}
                  {r.app_version ? ` · v${r.app_version}` : ""}
                </p>

                <div className="flex items-center gap-2">
                  <Select
                    className="max-w-[10rem]"
                    value={r.status}
                    aria-label="Status"
                    onChange={(e) =>
                      void updateReport.mutateAsync({
                        id: r.id,
                        status: e.target.value as IssueReportStatus,
                      })
                    }
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In progress</option>
                    <option value="resolved">Resolved</option>
                    <option value="wont_fix">Won't fix</option>
                  </Select>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </BrowsePage>
  );
}
