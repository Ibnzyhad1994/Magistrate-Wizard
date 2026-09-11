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
import {
  columnApplies,
  visibleBoardColumns,
  type BoardColumn,
  type ProcedureColumnKey,
} from "@/lib/docket-procedure";
import { logProcedurePatch } from "@/lib/docket-procedure-log";
import {
  adjournmentForStage,
  boardCellValue,
  boardColumnPatch,
  matterProtocol,
  matterProtocolStage,
  mergeStageAdjournment,
  outcomeBoardPatch,
} from "@/lib/docket-protocols";
import { ROUTES } from "@/routes/paths";
import type { DocketMatterBoardRow } from "@/hooks/docket/use-docket-matters";
import { useUploadDocument } from "@/hooks/use-documents";
import type { Json, TablesUpdate } from "@/types/database.types";
import { matterClassificationLabel } from "@/lib/validations/docket";
import { ProcedureColumnHeading } from "@/pages/docket/procedure-column-heading";

export type LogAppearanceRequest = {
  matterId: string;
  event_type: string;
  stage_at_event: string;
  notes: string;
};

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
}: {
  row: DocketMatterBoardRow;
  columns: BoardColumn[];
  showCourt: boolean;
  isTourNextDate?: boolean;
  isTourOutcome?: boolean;
  isTourFirstMatter?: boolean;
  onPatch: (id: string, values: TablesUpdate<"docket_matters">, expectedUpdatedAt: string | null) => Promise<unknown>;
  onLogAppearance: (request: LogAppearanceRequest) => void;
}) {
  const uploadRuling = useUploadDocument("docket_matter", row.id);
  const uploadJudgment = useUploadDocument("docket_matter", row.id);
  const caseColBase =
    "sticky left-0 w-[8.75rem] max-w-[8.75rem] overflow-hidden bg-card shadow-[2px_0_0_0_hsl(var(--foreground)/0.08)] sm:w-56 sm:max-w-56 md:w-[14rem] md:max-w-[14rem]";
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
      await onPatch(row.id, { stage_adjournments: next as Json }, row.updated_at);
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
    <TableRow>
      <TableCell className={`${caseColBase} z-20`}>
        <Link
          to={ROUTES.docketMatter(row.id)}
          className="block min-w-0 hover:underline"
          data-tour={isTourFirstMatter ? "docket-first-matter" : undefined}
        >
          <p className="truncate text-xs font-semibold text-foreground/55">{row.case_number}</p>
          <p className="truncate text-sm text-foreground">{row.matter_title}</p>
          {row.charge_or_issue && (
            <p className="hidden truncate text-xs text-foreground/45 sm:block">{row.charge_or_issue}</p>
          )}
          {classification && (
            <span className="mt-0.5 inline-block truncate rounded-[2px] border border-foreground/20 bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/80">
              {classification}
            </span>
          )}
          {showCourt && row.court_name && (
            <span className="mt-0.5 inline-block truncate rounded-[2px] border border-foreground/20 bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/80">
              {row.court_name}
            </span>
          )}
          {row.appearance_status && (
            <span
              className={`mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                row.appearance_status === "scheduled"
                  ? "bg-primary/20 text-primary"
                  : row.appearance_status === "completed"
                    ? "bg-foreground/10 text-foreground/60"
                    : "bg-foreground/5 text-foreground/40"
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
        const applicable = columnApplies(column, protocol);
        const purpose = ATTACHMENT_PURPOSE[column.key];
        const uploadMutation = purpose === "ruling" ? uploadRuling : purpose === "judgment" ? uploadJudgment : null;
        const adjournment = adjournmentForStage(row.stage_adjournments, column.stage);
        return (
          <TableCell key={column.key} className="p-1.5">
            <DocketStageCell
              column={column.key}
              value={boardCellValue(row, column.key)}
              canEdit={row.can_edit && applicable}
              isCurrent={applicable && stage === column.stage}
              applicable={applicable}
              protocol={protocol}
              categoryName={row.category_name}
              onChange={(next) => void handleChange(column.key, next)}
              adjournment={
                applicable && protocol === "civil_summons"
                  ? {
                      ...adjournment,
                      onSave: (nextAdjourned, reason) =>
                        void handleAdjournment(column, nextAdjourned, reason),
                    }
                  : undefined
              }
              attachments={
                applicable && purpose && uploadMutation && row.can_edit
                  ? {
                      hasFile: purpose === "ruling" ? row.has_ruling_document : row.has_judgment_document,
                      isUploading: uploadMutation.isPending,
                      onUpload: (file) => uploadMutation.mutate({ file, purpose }),
                    }
                  : undefined
              }
            />
          </TableCell>
        );
      })}
      <TableCell className="p-1.5" data-tour-join={isTourOutcome ? "docket-outcome" : undefined}>
        <DocketOutcomeCell
          value={row.outcome_status}
          outcomeAdjourned={row.outcome_adjourned}
          protocol={protocol}
          canEdit={row.can_edit}
          onChange={(next) => void handleOutcomeChange(next)}
        />
      </TableCell>
      <TableCell
        className="whitespace-nowrap"
        data-tour-join={isTourNextDate ? "docket-next-date" : undefined}
      >
        <NextDateCell
          matterId={row.id}
          nextDate={row.next_appearance}
          matterCategoryId={row.category_id}
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
}: {
  rows: DocketMatterBoardRow[];
  showCourt?: boolean;
  onPatch: (id: string, values: TablesUpdate<"docket_matters">, expectedUpdatedAt: string | null) => Promise<unknown>;
  onLogAppearance: (request: LogAppearanceRequest) => void;
}) {
  const caseColBase =
    "sticky left-0 w-[8.75rem] max-w-[8.75rem] overflow-hidden bg-card shadow-[2px_0_0_0_hsl(var(--foreground)/0.08)] sm:w-56 sm:max-w-56 md:w-[14rem] md:max-w-[14rem]";
  const columns = visibleBoardColumns(rows);

  return (
    <div className="relative" data-tour="docket-board">
      <div className="relative rounded-sm border border-foreground/10">
        <Table className="min-w-[56rem] border-separate border-spacing-0 sm:min-w-[72rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={`${caseColBase} z-30`}>Case</TableHead>
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  className="sticky top-0 z-20 min-w-[5.75rem] whitespace-nowrap bg-card sm:min-w-[7rem]"
                  data-tour-focus={column.key === "arraignment_status" ? "" : undefined}
                >
                  <ProcedureColumnHeading columnKey={column.key} label={column.label} />
                </TableHead>
              ))}
              <TableHead
                className="sticky top-0 z-20 min-w-[6.5rem] whitespace-nowrap bg-card sm:min-w-[7rem]"
                data-tour="docket-outcome"
              >
                Outcome
              </TableHead>
              <TableHead
                className="sticky top-0 z-20 min-w-[6.5rem] whitespace-nowrap bg-card sm:min-w-[7.5rem]"
                data-tour="docket-next-date"
              >
                Next date
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <DocketStageRow
                key={row.id}
                row={row}
                columns={columns}
                showCourt={showCourt}
                isTourNextDate={index === 0}
                isTourOutcome={index === 0}
                isTourFirstMatter={index === 0}
                onPatch={onPatch}
                onLogAppearance={onLogAppearance}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
