import { useState } from "react";
import { Link } from "react-router-dom";
import { RotateCcw, Trash2 } from "lucide-react";
import { BrowseHeader, BrowsePage } from "@/components/browse";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog } from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useBinnedDocketMatters,
  usePurgeDocketMatter,
  useRestoreDocketMatter,
} from "@/hooks/docket/use-docket-matters";
import { docketBinDaysLabel, docketBinPurgeAt } from "@/lib/docket-bin";
import { formatDateTime, toTitleCase } from "@/lib/utils";
import { ROUTES } from "@/routes/paths";
import { useBackNav } from "@/hooks/use-back-nav";

export default function DocketBinPage() {
  const back = useBackNav(ROUTES.docket, "Back to Docket");
  const { data, isPending, isError, error, refetch } = useBinnedDocketMatters();
  const restoreMatter = useRestoreDocketMatter();
  const purgeMatter = usePurgeDocketMatter();
  const [purgeId, setPurgeId] = useState<string | null>(null);

  return (
    <BrowsePage>
      <BrowseHeader
        title="Docket bin"
        description="Deleted files stay here for 7 days. Restore to put them back on the docket, or empty now to permanently delete."
        action={
          <Button variant="outline" asChild>
            <Link to={back.to}>{back.label}</Link>
          </Button>
        }
      />

      {isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={Trash2}
          title="Bin is empty"
          description="Matters you delete from the docket appear here for 7 days."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case</TableHead>
              <TableHead>Court</TableHead>
              <TableHead>Binned</TableHead>
              <TableHead>Purge</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link
                    to={ROUTES.docketMatter(row.id)}
                    className="font-medium text-foreground hover:underline"
                  >
                    {row.case_number}
                  </Link>
                  <p className="text-sm text-muted-foreground">{row.matter_title}</p>
                  <p className="text-xs text-muted-foreground">{toTitleCase(row.status)}</p>
                </TableCell>
                <TableCell className="text-muted-foreground">{row.court_name ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(row.deleted_at)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <p>{docketBinDaysLabel(row.deleted_at)}</p>
                  <p className="text-xs">
                    {formatDateTime(docketBinPurgeAt(row.deleted_at).toISOString())}
                  </p>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={restoreMatter.isPending}
                      onClick={() => restoreMatter.mutate(row.id)}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Restore
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={purgeMatter.isPending}
                      onClick={() => setPurgeId(row.id)}
                    >
                      Empty now
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AlertDialog
        open={!!purgeId}
        onOpenChange={(open) => !open && setPurgeId(null)}
        title="Permanently delete this matter?"
        description="This cannot be undone. The file, its hearings, parties, tags, shares, and linked documents are removed. Judgments and case law themselves are kept."
        confirmLabel="Empty now"
        isConfirming={purgeMatter.isPending}
        onConfirm={() => {
          if (!purgeId) return;
          purgeMatter.mutate(purgeId, {
            onSuccess: () => setPurgeId(null),
          });
        }}
      />
    </BrowsePage>
  );
}
