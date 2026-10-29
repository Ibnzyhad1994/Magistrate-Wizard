import { usePendingMatterIds } from "@/hooks/offline/use-pending-hearings";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DocketStageCell } from "@/pages/docket/docket-stage-cell";
import { DocketOutcomeCell } from "@/pages/docket/docket-outcome-cell";
import { NextDateCell } from "@/pages/docket/next-date-cell";
import type { BoardColumn, ProcedureColumnKey } from "@/lib/docket-procedure";
import { logProcedurePatch } from "@/lib/docket-procedure-log";
import {
  adjournmentForStage,
  boardCellValue,
  boardColumnPatch,
  boardWorkflowGroups,
  matterProtocol,
  matterProtocolStage,
  mergeStageAdjournment,
  outcomeBoardPatch,
  protocolLabel,
} from "@/lib/docket-protocols";
import { ROUTES } from "@/routes/paths";
import { CalloverChip } from "@/components/common/callover-chip";
import type { DocketMatterBoardRow } from "@/hooks/docket/use-docket-matters";
import { useUploadDocument } from "@/hooks/use-documents";
import type { Json, TablesUpdate } from "@/types/database.types";
import { matterClassificationLabel } from "@/lib/validations/docket";
import { ProcedureColumnHeading } from "@/pages/docket/procedure-column-heading";
import { badgeVariants } from "@/components/ui/badge-variants";
import { cn } from "@/lib/utils";

export type LogAppearanceRequest = {
  matterId: string;
  event_type: string;
  stage_at_event: string;
  notes: string;
};

/**
 * Outcome and Next date are pinned to the right edge the way Case is
 * pinned to the left, so the procedure stages scroll between them. With
 * eight or more stages the sheet is wider than a 1280-1440 px window, and
 * these two columns (what the matter came to, and when it is back) used to
 * sit behind a horizontal scroll with no cue that they existed. Fixed
 * widths, because Outcome's offset is Next date's width.
 */
const NEXT_DATE_COL = "sticky right-0 w-[7.5rem] min-w-[7.5rem] max-w-[7.5rem]";
const OUTCOME_COL =
  "sticky right-[7.5rem] w-[7.5rem] min-w-[7.5rem] max-w-[7.5rem] border-l border-border";

const ATTACHMENT_PURPOSE: Partial<Record<ProcedureColumnKey, "ruling" | "judgment">> = {
  ruling_status: "ruling",
  judgment_status: "judgment",
};

function DocketStageRow({
  row,
  columns,
  showCourt,
  isTourNextDate,
  isTourOutcome,
  isTourFirstMatter,
  onPatch,
  onLogAppearance,
  pending = false,
  onCallover = false,
  selection,
}: {
  row: DocketMatterBoardRow;
  columns: BoardColumn[];
  showCourt: boolean;
  /** On a callover on the day this list shows. */
  onCallover?: boolean;
  isTourNextDate?: boolean;
  isTourOutcome?: boolean;
  isTourFirstMatter?: boolean;
  /** This file has board changes queued on this device. */
  pending?: boolean;
  /** Absent when the list cannot be bulk-adjourned (no date, or a past one). */
  selection?: { isSelected: boolean; onToggle: () => void };
  onPatch: (
    id: string,
    values: TablesUpdate<"docket_matters">,
    expectedUpdatedAt: string | null,
  ) => Promise<unknown>;
  onLogAppearance: (request: LogAppearanceRequest) => void;
}) {
  const uploadRuling = useUploadDocument("docket_matter", row.id);
  const uploadJudgment = useUploadDocument("docket_matter", row.id);
  const caseColBase =
    "sticky left-0 w-[8.75rem] max-w-[8.75rem] overflow-hidden border-r border-border sm:w-56 sm:max-w-56 md:w-[14rem] md:max-w-[14rem]";
  const protocol = matterProtocol(row);
  const stage = matterProtocolStage(row);
  const classification = matterClassificationLabel(row.category_name, row.category_other);

  async function handleChange(column: ProcedureColumnKey, next: string) {
    const previous = boardCellValue(row, column);
    const patchValues = boardColumnPatch(column, next, row.category_name);
    const undoValues = boardColumnPatch(column, previous, row.category_name);
    await logProcedurePatch({
      column,
      previous,
      next,
      expectedUpdatedAt: row.updated_at,
      patchValues,
      undoValues,
      patch: (values, expectedUpdatedAt) =>
        onPatch(row.id, values as TablesUpdate<"docket_matters">, expectedUpdatedAt),
      onLogAppearance: (hint) => onLogAppearance({ matterId: row.id, ...hint }),
    });
  }

  async function handleAdjournment(column: BoardColumn, adjourned: boolean, reason: string) {
    try {
      const next = mergeStageAdjournment(row.stage_adjournments, column.stage, adjourned, reason);
      await onPatch(row.id, { stage_adjournments: next as NonNullable<Json> }, row.updated_at);
      toast.success(adjourned ? "Stage adjourned." : "Adjournment cleared.");
    } catch {
      // Mutation cache toast subscriber.
    }
  }

  async function handleOutcomeChange(next: string | null) {
    try {
      await onPatch(row.id, outcomeBoardPatch(next), row.updated_at);
      toast.success(next ? "Outcome updated." : "Outcome cleared.");
    } catch {
      // Surfaced globally via the mutation cache toast subscriber.
    }
  }

  return (
    // Marked at the row, not per cell: 14 procedure columns across three
    // layouts would be forty-odd places to keep in step, and what the
    // magistrate needs to know is that this FILE has unsent changes.
    <TableRow className={pending ? "group/row bg-warning/10" : "group/row"}>
      {selection && (
        <TableCell className="w-9 px-2">
          <Checkbox
            checked={selection.isSelected}
            onCheckedChange={selection.onToggle}
            disabled={!row.can_edit}
            aria-label={`Select ${row.case_number} ${row.matter_title}`}
          />
        </TableCell>
      )}
      <TableCell className={`${caseColBase} z-20 bg-card group-hover/row:bg-surface-2`}>
        <Link
          to={ROUTES.docketMatter(row.id)}
          className="block min-w-0 hover:underline"
          data-tour={isTourFirstMatter ? "docket-first-matter" : undefined}
        >
          <p className="identifier truncate text-xs font-semibold text-muted-foreground">
            {row.case_number}
          </p>
          <p className="truncate text-sm text-foreground">{row.matter_title}</p>
          {pending && (
            <p className="truncate text-[11px] font-medium text-warning">
              Saved on this device, not yet synced.
            </p>
          )}
          {row.charge_or_issue && (
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              {row.charge_or_issue}
            </p>
          )}
          {classification && (
            <span className={cn(badgeVariants({ variant: "tag" }), "mt-0.5")}>
              {classification}
            </span>
          )}
          {showCourt && row.court_name && (
            <span className={cn(badgeVariants({ variant: "tag" }), "mt-0.5")}>
              {row.court_name}
            </span>
          )}
          {onCallover && <CalloverChip className="mr-1" />}
          {row.appearance_status && (
            <span
              className={`mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                row.appearance_status === "scheduled"
                  ? "bg-primary/15 text-link"
                  : row.appearance_status === "completed"
                    ? "bg-foreground/10 text-muted-foreground"
                    : "bg-foreground/5 text-muted-foreground"
              }`}
            >
              {row.appearance_status === "scheduled"
                ? "Scheduled"
                : row.appearance_status === "completed"
                  ? row.appearance_outcome || "Heard / Adjourned"
                  : "Rescheduled"}
            </span>
          )}
        </Link>
      </TableCell>
      {columns.map((column) => {
        const purpose = ATTACHMENT_PURPOSE[column.key];
        const uploadMutation =
          purpose === "ruling" ? uploadRuling : purpose === "judgment" ? uploadJudgment : null;
        const adjournment = adjournmentForStage(row.stage_adjournments, column.stage);
        return (
          <TableCell key={column.key} className="p-1.5">
            <DocketStageCell
              column={column.key}
              value={boardCellValue(row, column.key)}
              canEdit={row.can_edit}
              isCurrent={stage === column.stage}
              protocol={protocol}
              categoryName={row.category_name}
              onChange={(next) => void handleChange(column.key, next)}
              adjournment={
                protocol === "civil_summons"
                  ? {
                      ...adjournment,
                      onSave: (nextAdjourned, reason) =>
                        void handleAdjournment(column, nextAdjourned, reason),
                    }
                  : undefined
              }
              attachments={
                purpose && uploadMutation && row.can_edit
                  ? {
                      hasFile:
                        purpose === "ruling" ? row.has_ruling_document : row.has_judgment_document,
                      isUploading: uploadMutation.isPending,
                      onUpload: (file) => uploadMutation.mutate({ file, purpose }),
                    }
                  : undefined
              }
            />
          </TableCell>
        );
      })}
      <TableCell
        className={`${OUTCOME_COL} z-20 bg-card p-1.5 group-hover/row:bg-surface-2`}
        data-tour-join={isTourOutcome ? "docket-outcome" : undefined}
      >
        <DocketOutcomeCell
          value={row.outcome_status}
          outcomeAdjourned={row.outcome_adjourned}
          protocol={protocol}
          canEdit={row.can_edit}
          onChange={(next) => void handleOutcomeChange(next)}
        />
      </TableCell>
      <TableCell
        className={`${NEXT_DATE_COL} z-20 whitespace-nowrap bg-card group-hover/row:bg-surface-2`}
        data-tour-join={isTourNextDate ? "docket-next-date" : undefined}
      >
        <NextDateCell
          matterId={row.id}
          nextDate={row.next_appearance}
          matterCategoryId={row.category_id}
          courtId={row.court_id}
          districtId={row.district_id}
          canEdit={row.can_edit}
        />
      </TableCell>
    </TableRow>
  );
}

export function DocketStageSheet({
  rows,
  showCourt = false,
  onPatch,
  onLogAppearance,
  selection,
  calloverMatterIds,
}: {
  rows: DocketMatterBoardRow[];
  showCourt?: boolean;
  /** Matters on a callover on the day this list shows. */
  calloverMatterIds?: ReadonlySet<string>;
  /** Omitted entirely when bulk adjourn is not offered for this list. */
  selection?: {
    selected: ReadonlySet<string>;
    onToggle: (id: string) => void;
    onToggleAll: () => void;
    allSelected: boolean;
  };
  onPatch: (
    id: string,
    values: TablesUpdate<"docket_matters">,
    expectedUpdatedAt: string | null,
  ) => Promise<unknown>;
  onLogAppearance: (request: LogAppearanceRequest) => void;
}) {
  const pendingMatters = usePendingMatterIds();
  const caseColBase =
    "sticky left-0 w-[8.75rem] max-w-[8.75rem] overflow-hidden border-r border-border sm:w-56 sm:max-w-56 md:w-[14rem] md:max-w-[14rem]";
  // A table per workflow, each with only its own stages: one shared table
  // filled every civil row with N/A under the criminal columns (and the
  // reverse), and that dead width pushed the real stages off screen.
  const groups = boardWorkflowGroups(rows);
  const titled = groups.length > 1;

  return (
    <div className="relative flex flex-col gap-4" data-tour="docket-board">
      {groups.map((group, groupIndex) => {
        const label = protocolLabel(group.protocol);
        const headingId = `docket-board-${group.protocol}`;
        const isFirstGroup = groupIndex === 0;
        return (
          <section key={group.protocol} aria-labelledby={titled ? headingId : undefined}>
            {titled && (
              <h3
                id={headingId}
                className="mb-1.5 flex items-baseline gap-2 text-sm font-semibold text-foreground"
              >
                {label}
                <span className="text-xs font-normal tabular-nums text-muted-foreground">
                  {group.rows.length} {group.rows.length === 1 ? "file" : "files"}
                </span>
              </h3>
            )}
            <div className="relative overflow-hidden rounded-md border border-hairline shadow-elevation-1 hc:border-border">
              <Table
                className="border-separate border-spacing-0"
                aria-label={titled ? `Docket board: ${label}` : "Docket board"}
              >
                <TableHeader className="[&>tr>th]:border-b [&>tr>th]:border-border">
                  <TableRow className="hover:bg-transparent">
                    {selection && (
                      <TableHead className="w-9 px-2">
                        {/* One select-all for the whole list, not per table. */}
                        {isFirstGroup && (
                          <Checkbox
                            checked={selection.allSelected}
                            onCheckedChange={selection.onToggleAll}
                            aria-label="Select every file you can edit"
                          />
                        )}
                      </TableHead>
                    )}
                    <TableHead className={`${caseColBase} z-30 bg-surface-1`}>Case</TableHead>
                    {group.columns.map((column) => (
                      <TableHead
                        key={column.key}
                        className="sticky top-0 z-20 min-w-[5.75rem] whitespace-nowrap bg-surface-1 sm:min-w-[7rem]"
                        data-tour-focus={
                          isFirstGroup && column.key === "arraignment_status" ? "" : undefined
                        }
                      >
                        <ProcedureColumnHeading columnKey={column.key} label={column.label} />
                      </TableHead>
                    ))}
                    <TableHead
                      className={`${OUTCOME_COL} top-0 z-30 whitespace-nowrap bg-surface-1`}
                      data-tour={isFirstGroup ? "docket-outcome" : undefined}
                    >
                      Outcome
                    </TableHead>
                    <TableHead
                      className={`${NEXT_DATE_COL} top-0 z-30 whitespace-nowrap bg-surface-1`}
                      data-tour={isFirstGroup ? "docket-next-date" : undefined}
                    >
                      Next date
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="tabular-nums [&>tr:last-child>td]:border-b-0 [&>tr>td]:border-b [&>tr>td]:border-border">
                  {group.rows.map((row, index) => {
                    const isTourRow = isFirstGroup && index === 0;
                    return (
                      <DocketStageRow
                        key={row.id}
                        row={row}
                        columns={group.columns}
                        showCourt={showCourt}
                        isTourNextDate={isTourRow}
                        isTourOutcome={isTourRow}
                        isTourFirstMatter={isTourRow}
                        onPatch={onPatch}
                        onLogAppearance={onLogAppearance}
                        pending={pendingMatters.has(row.id)}
                        onCallover={calloverMatterIds?.has(row.id) ?? false}
                        selection={
                          selection
                            ? {
                                isSelected: selection.selected.has(row.id),
                                onToggle: () => selection.onToggle(row.id),
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
