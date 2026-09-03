import { useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { AlertDialog } from "@/components/ui/alert-dialog";
import {
  useJudgmentVersions,
  useRestoreJudgmentVersion,
} from "@/hooks/judgments/use-judgment-versions";
import { canRestoreJudgmentVersion } from "@/lib/judgment-versions";
import { formatDateTime } from "@/lib/utils";

export function JudgmentVersionHistory({
  judgmentId,
  status,
}: {
  judgmentId: string;
  status: string;
}) {
  const { data, isPending, isError, error, refetch } = useJudgmentVersions(judgmentId);
  const restore = useRestoreJudgmentVersion(judgmentId, status);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const canRestore = canRestoreJudgmentVersion(status);
  const pending = data?.find((row) => row.id === pendingId) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Version history</CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <InlineError error={error} onRetry={() => void refetch()} />
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon={History}
            title="No previous versions"
            description="Edits to title, citation, court, date, or body are saved here automatically."
          />
        ) : (
          <ul className="space-y-3">
            {data.map((version) => (
              <li
                key={version.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border p-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    Version {version.version_number}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {formatDateTime(version.created_at)}
                    </span>
                  </p>
                  <p className="text-sm text-foreground">{version.title}</p>
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                    {(version.content_text || "No body text recorded.").slice(0, 400)}
                    {(version.content_text?.length ?? 0) > 400 ? "…" : ""}
                  </p>
                </div>
                {canRestore && (
                  <Button size="sm" variant="outline" onClick={() => setPendingId(version.id)}>
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!canRestore && (
          <p className="mt-3 text-xs text-muted-foreground">
            Unlock this judgment to a draft before restoring a previous version.
          </p>
        )}
      </CardContent>
      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => !open && setPendingId(null)}
        title="Restore this version?"
        description="The current draft title, citation, court, date, and body will be replaced. A snapshot of what is on the page now is kept in history."
        confirmLabel="Restore"
        isConfirming={restore.isPending}
        onConfirm={() => {
          if (!pending) return;
          restore.mutate(
            {
              title: pending.title,
              case_number: pending.case_number,
              citation: pending.citation,
              court_name: pending.court_name,
              judgment_date: pending.judgment_date,
              content: pending.content,
              content_text: pending.content_text,
            },
            { onSuccess: () => setPendingId(null) },
          );
        }}
      />
    </Card>
  );
}
