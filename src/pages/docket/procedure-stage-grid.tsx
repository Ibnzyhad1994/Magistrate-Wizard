import { cn } from "@/lib/utils";
import { DocketStageCell, type StageCellAttachments, type StageCellAdjournment } from "@/pages/docket/docket-stage-cell";
import {
  PROCEDURE_COLUMNS,
  columnApplies,
  type BoardColumn,
  type ProcedureColumnKey,
  type ProcedureStage,
  type WorkflowProtocol,
} from "@/lib/docket-procedure";
import { ProcedureColumnHeading } from "@/pages/docket/procedure-column-heading";

export function ProcedureStageGrid({
  getValue,
  canEdit,
  currentStage,
  compact,
  cellClassName,
  layout,
  attachmentsFor,
  onChange,
  columns = PROCEDURE_COLUMNS,
  protocol = "criminal_trial",
  categoryName,
  adjournmentFor,
}: {
  getValue: (column: ProcedureColumnKey) => string;
  canEdit: boolean;
  currentStage: ProcedureStage | null;
  compact?: boolean;
  cellClassName?: string;
  layout: "overview" | "board-card";
  attachmentsFor?: (column: ProcedureColumnKey) => StageCellAttachments | undefined;
  onChange: (column: ProcedureColumnKey, next: string) => void;
  columns?: readonly BoardColumn[];
  protocol?: WorkflowProtocol;
  categoryName?: string | null;
  adjournmentFor?: (column: BoardColumn) => StageCellAdjournment | undefined;
}) {
  return (
    <div
      className={cn(
        layout === "overview"
          ? "grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:gap-2"
          : "grid grid-cols-2 gap-3",
      )}
    >
      {columns.map((column) => {
        const applicable = columnApplies(column, protocol);
        return (
          <div
            key={column.key}
            data-tour-focus={
              layout === "board-card" && column.key === "arraignment_status" ? "" : undefined
            }
            className={cn("min-w-0 space-y-1", layout === "overview" && "sm:min-w-[6.5rem]")}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <ProcedureColumnHeading columnKey={column.key} label={column.label} />
            </p>
            <DocketStageCell
              column={column.key}
              value={getValue(column.key)}
              canEdit={canEdit && applicable}
              isCurrent={applicable && currentStage === column.stage}
              compact={compact}
              className={cellClassName}
              onChange={(next) => onChange(column.key, next)}
              attachments={applicable ? attachmentsFor?.(column.key) : undefined}
              applicable={applicable}
              protocol={protocol}
              categoryName={categoryName}
              adjournment={
                applicable && protocol === "civil_summons" ? adjournmentFor?.(column) : undefined
              }
            />
          </div>
        );
      })}
    </div>
  );
}
