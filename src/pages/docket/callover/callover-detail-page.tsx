import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Gavel, ListPlus, Plus, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog } from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { Billboard } from "@/components/browse";
import { CreateDocketMatterDialog } from "@/pages/docket/create-docket-matter-dialog";
import { CalloverRow, type CalloverRowData } from "@/pages/docket/callover/callover-row";
import { CalloverReportButton } from "@/pages/docket/callover/callover-report-button";
import {
  useAddCalloverItem,
  useCallover,
  useCalloverItems,
  usePopulateCallover,
  useRemoveCalloverItem,
  useUpdateCallover,
  useUpdateCalloverItem,
} from "@/hooks/docket/use-callovers";
import {
  CALLOVER_STATUS_LABELS,
  calloverProgress,
  defaultCalloverTitle,
  isCalloverEditable,
  isCalloverStatus,
  itemsMissingExpectedNextDate,
  sortCalloverItems,
} from "@/lib/callover";
import { ROUTES } from "@/routes/paths";
import { formatDate } from "@/lib/utils";

/**
 * The running sheet. One row per matter, saved as you go — nothing is
 * batched behind a Save button, because a sitting that loses its last ten
 * decisions to a closed tab is worse than useless.
 */
export default function CalloverDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: callover, isPending, isError, error, refetch } = useCallover(id);
  const { data: items, isPending: itemsPending } = useCalloverItems(id);

  const updateCallover = useUpdateCallover(id);
  const updateItem = useUpdateCalloverItem(id);
  const removeItem = useRemoveCalloverItem(id);
  const populate = usePopulateCallover(id);
  const addItem = useAddCalloverItem(id);

  const [addOpen, setAddOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);

  const rows = useMemo(
    () => sortCalloverItems((items ?? []) as unknown as CalloverRowData[]),
    [items],
  );
  const progress = calloverProgress(rows);
  const missingDates = itemsMissingExpectedNextDate(rows);

  const status = isCalloverStatus(callover?.status) ? callover.status : "draft";
  const editable = isCalloverEditable(status);

  if (isPending) {
    return (
      <div className="browse-gutter space-y-4 pt-24">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError) return <InlineError error={error} onRetry={() => void refetch()} />;

  if (!callover) {
    return (
      <InlineError
        error={new Error("This callover doesn't exist, or you no longer have access to it.")}
      />
    );
  }

  const title = callover.title || defaultCalloverTitle(callover.callover_date);

  return (
    <>
      <Billboard
        variant="detail"
        eyebrow={callover.courts?.name ?? undefined}
        title={title}
        description={`${formatDate(callover.callover_date)} · ${progress.called} of ${progress.total} called`}
        badges={[CALLOVER_STATUS_LABELS[status]]}
        tone="docket"
        primaryAction={{ label: "Back to callovers", onClick: () => navigate(ROUTES.callovers) }}
      />

      <div className="browse-gutter relative z-10 -mt-6 space-y-4 pb-20">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status === "completed" ? "outline" : "default"}>
            {CALLOVER_STATUS_LABELS[status]}
          </Badge>

          {editable && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => populate.mutate(null)}
                disabled={populate.isPending}
              >
                {populate.isPending ? <LoadingSpinner size={14} /> : <ListPlus className="h-4 w-4" />}
                Fill from this date&apos;s list
              </Button>

              <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" />
                Add a matter not on the system
              </Button>
            </>
          )}

          {rows.length > 0 && (
            <CalloverReportButton
              callover={callover}
              rows={rows}
              title={title}
            />
          )}

          {editable ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCompleteOpen(true)}
              disabled={updateCallover.isPending || rows.length === 0}
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark completed
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => updateCallover.mutate({ status: "in_progress" })}
              disabled={updateCallover.isPending}
            >
              <RotateCcw className="h-4 w-4" />
              Reopen
            </Button>
          )}
        </div>

        {!editable && (
          <p className="rounded-md border border-foreground/10 bg-foreground/[0.03] px-4 py-3 text-sm text-muted-foreground">
            This callover is completed and is now a record of the sitting. Reopen it
            to make further changes.
          </p>
        )}

        {itemsPending ? (
          <Skeleton className="h-48 w-full rounded-sm" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title="No matters on this callover yet"
            description="Fill it from the matters already listed for this date, or add one that pre-dates the docket."
            action={
              editable && (
                <Button
                  variant="play"
                  size="sm"
                  onClick={() => populate.mutate(null)}
                  disabled={populate.isPending}
                >
                  <ListPlus className="h-4 w-4" />
                  Fill from this date&apos;s list
                </Button>
              )
            }
          />
        ) : (
          <div className="relative rounded-sm border border-foreground/10">
            <Table className="min-w-[52rem] border-separate border-spacing-0">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="sticky left-0 z-30 w-[9rem] max-w-[9rem] bg-card sm:w-56 sm:max-w-56">
                    Case
                  </TableHead>
                  <TableHead className="whitespace-nowrap">Stage</TableHead>
                  <TableHead className="whitespace-nowrap">Outcome</TableHead>
                  <TableHead className="whitespace-nowrap">Next date</TableHead>
                  <TableHead className="whitespace-nowrap">Notes</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <CalloverRow
                    key={row.id}
                    row={row}
                    editable={editable}
                    onPatch={(itemId, values) => updateItem.mutate({ id: itemId, values })}
                    onRemove={(itemId) => removeItem.mutate(itemId)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Intake opens with the brought-forward disclosure already expanded:
          anything added mid-callover is, by definition, a matter that
          pre-dates this docket. On success it becomes an item on this
          sheet rather than navigating away and losing the sitting. */}
      <CreateDocketMatterDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultCourtId={callover.court_id}
        defaultBroughtForward
        onCreated={(matterId) => addItem.mutate({ matterId, sortOrder: rows.length + 1 })}
      />

      <AlertDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        title="Mark this callover completed?"
        description={
          missingDates.length > 0
            ? `${missingDates.length} matter${missingDates.length === 1 ? " was" : "s were"} given an outcome that usually fixes a return date, but ${missingDates.length === 1 ? "has" : "have"} none set. You can still complete the sitting, and reopen it later if needed.`
            : "The sheet becomes a read-only record of the sitting. You can reopen it later if something needs correcting."
        }
        confirmLabel="Mark completed"
        isConfirming={updateCallover.isPending}
        onConfirm={() => {
          updateCallover.mutate(
            { status: "completed" },
            { onSuccess: () => setCompleteOpen(false) },
          );
        }}
      />
    </>
  );
}
