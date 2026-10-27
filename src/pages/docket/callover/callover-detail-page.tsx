import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { usePageTitle } from "@/hooks/use-page-title";
import { CalendarCheck, CheckCircle2, Gavel, ListPlus, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { statusBadgeVariant } from "@/components/common/status-badge-variant";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { PageError, PageNotFound } from "@/components/browse/page-error";
import { isNotFoundError, recordIdOrUndefined } from "@/lib/record-id";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { Billboard } from "@/components/browse";
import { CalloverMatterDialog } from "@/pages/docket/callover/callover-matter-dialog";
import { CapacityOverrideDialog } from "@/pages/docket/capacity-override-dialog";
import { CalloverRow, type CalloverRowData } from "@/pages/docket/callover/callover-row";
import { CalloverReportButton } from "@/pages/docket/callover/callover-report-button";
import {
  useCallover,
  useCalloverItems,
  useCalloverListedMatters,
  useListCalloverItemsOnSchedule,
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
import {
  calloverAppearance,
  itemsMissingFromSchedule,
  type CapacityReached,
  type ScheduleCalloverAppearanceInput,
} from "@/lib/callover-schedule";
import { procedureStageLabel } from "@/lib/docket-procedure";
import { ROUTES } from "@/routes/paths";
import { formatDate } from "@/lib/utils";

/**
 * The running sheet. One row per matter, saved as you go — nothing is
 * batched behind a Save button, because a sitting that loses its last ten
 * decisions to a closed tab is worse than useless.
 */
export default function CalloverDetailPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = recordIdOrUndefined(idParam);
  const navigate = useNavigate();

  const { data: callover, isPending, isError, error, refetch } = useCallover(id);
  usePageTitle(callover ? callover.title || defaultCalloverTitle(callover.callover_date) : null);
  const { data: items, isPending: itemsPending } = useCalloverItems(id);

  const updateCallover = useUpdateCallover(id);
  const updateItem = useUpdateCalloverItem(id);
  const removeItem = useRemoveCalloverItem(id);
  const populate = usePopulateCallover(id);
  const listOnSchedule = useListCalloverItemsOnSchedule();

  const [addOpen, setAddOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [overCapacity, setOverCapacity] = useState<{
    rows: ScheduleCalloverAppearanceInput[];
    capacity: CapacityReached;
  } | null>(null);

  const rows = useMemo(
    () => sortCalloverItems((items ?? []) as unknown as CalloverRowData[]),
    [items],
  );
  const progress = calloverProgress(rows);
  const missingDates = itemsMissingExpectedNextDate(rows);

  // Rows typed in before callover matters were listed on their sitting day
  // (or added by any other route) are missing from that day's schedule.
  const sittingDate = callover?.callover_date;
  const matterIds = useMemo(() => rows.map((row) => row.docket_matter_id), [rows]);
  const { data: listedMatterIds } = useCalloverListedMatters(sittingDate, matterIds);
  const offSchedule = listedMatterIds ? itemsMissingFromSchedule(rows, listedMatterIds) : [];

  async function putOnSchedule(
    toList: ScheduleCalloverAppearanceInput[],
    acknowledgeOverride: boolean,
    overrideReason: string | null,
  ) {
    const result = await listOnSchedule.mutateAsync(
      toList.map((row) => ({ ...row, acknowledgeOverride, overrideReason })),
    );
    setOverCapacity(result.capacity ? { rows: result.refused, capacity: result.capacity } : null);
    if (result.listed > 0) {
      toast.success(
        `${result.listed} matter${result.listed === 1 ? "" : "s"} added to the ${formatDate(toList[0].date)} schedule.`,
      );
    }
  }

  function listOffSchedule() {
    if (!sittingDate) return;
    void putOnSchedule(
      offSchedule.map((row) => ({
        matterId: row.docket_matter_id,
        date: sittingDate,
        categoryId: row.docket_matters?.category_id ?? null,
        stageAtEvent: row.docket_matters?.procedure_stage
          ? procedureStageLabel(row.docket_matters.procedure_stage)
          : null,
        ...calloverAppearance(row),
      })),
      false,
      null,
    ).catch(() => {
      // Surfaced by the mutation's own error toast.
    });
  }

  const status = isCalloverStatus(callover?.status) ? callover.status : "draft";
  const editable = isCalloverEditable(status);

  const notFound = (
    <PageNotFound
      message="This callover doesn't exist, or you no longer have access to it."
      back={{ to: ROUTES.callovers, label: "Back to callovers" }}
    />
  );

  if (!id) return notFound;

  if (isPending) {
    return (
      <div className="browse-gutter space-y-4 pt-24">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isError) {
    if (isNotFoundError(error)) return notFound;
    return <PageError error={error} onRetry={() => void refetch()} />;
  }

  if (!callover) return notFound;

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
          <Badge variant={statusBadgeVariant(status)}>{CALLOVER_STATUS_LABELS[status]}</Badge>

          {editable && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => populate.mutate(null)}
                disabled={populate.isPending}
              >
                {populate.isPending ? (
                  <LoadingSpinner size={14} />
                ) : (
                  <ListPlus className="h-4 w-4" />
                )}
                Fill from this date&apos;s list
              </Button>

              <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" />
                Add a matter not on the system
              </Button>
            </>
          )}

          {rows.length > 0 && (
            <CalloverReportButton callover={callover} rows={rows} title={title} />
          )}

          {editable && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCompleteOpen(true)}
              disabled={updateCallover.isPending || rows.length === 0}
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark completed
            </Button>
          )}
        </div>

        {!editable && (
          <p className="rounded-md border border-border bg-foreground/[0.03] px-4 py-3 text-sm text-muted-foreground">
            This callover is complete. Its sheet is the record of the sitting and can no longer be
            changed. Its matters stay on the schedule.
          </p>
        )}

        {offSchedule.length > 0 ? (
          <Alert variant="warning" className="flex flex-wrap items-center justify-between gap-3">
            <AlertDescription>
              {offSchedule.length === 1
                ? "1 matter on this callover is"
                : `${offSchedule.length} matters on this callover are`}{" "}
              not on the {formatDate(callover.callover_date)} schedule or calendar.
            </AlertDescription>
            <Button size="sm" onClick={listOffSchedule} disabled={listOnSchedule.isPending}>
              {listOnSchedule.isPending ? (
                <LoadingSpinner className="text-current" size={14} />
              ) : (
                <CalendarCheck className="h-4 w-4" />
              )}
              Add to the schedule
            </Button>
          </Alert>
        ) : (
          rows.length > 0 &&
          listedMatterIds && (
            <p className="text-sm text-muted-foreground">
              Every matter here is on the {formatDate(callover.callover_date)} schedule. Marking the
              callover completed only locks this sheet.
            </p>
          )
        )}

        {itemsPending ? (
          <Skeleton className="h-48 w-full rounded-sm" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title="No matters on this callover yet"
            description="Fill it from this date's list, or add a matter by hand."
            action={
              editable && (
                <Button
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
          <div className="relative rounded-sm border border-border">
            <Table
              className="min-w-[52rem] border-separate border-spacing-0"
              aria-label="Callover running sheet"
            >
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

      {/* Anything added mid-callover is, by definition, a matter that
          pre-dates this docket. It is listed on the sitting day and joins
          this sheet, rather than navigating away and losing the sitting. */}
      <CalloverMatterDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        defaultCourtId={callover.court_id}
        date={callover.callover_date}
        calloverId={callover.id}
      />

      {overCapacity && (
        <CapacityOverrideDialog
          info={overCapacity.capacity}
          scheduledDate={callover.callover_date}
          isPending={listOnSchedule.isPending}
          onCancel={() => setOverCapacity(null)}
          onConfirm={(reason) => {
            void putOnSchedule(overCapacity.rows, true, reason).catch(() => {
              // Surfaced by the mutation's own error toast.
            });
          }}
        />
      )}

      <AlertDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        title="Mark this callover completed?"
        description={
          missingDates.length > 0
            ? `${missingDates.length} matter${missingDates.length === 1 ? " has" : "s have"} an outcome but no next date. A completed sheet cannot be changed, but each matter can still get a next date. Nothing is removed.`
            : "The sheet becomes the record of the sitting and cannot be reopened or changed. Its matters stay on the schedule and calendar."
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
