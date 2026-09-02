import { cn } from "@/lib/utils";
import { DocketStageCell, type StageCellAttachments } from "@/pages/docket/docket-stage-cell";
import {
  PROCEDURE_COLUMNS,
  type ProcedureColumnKey,
  type ProcedureStage,
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
}: {
  getValue: (column: ProcedureColumnKey) => string;
  canEdit: boolean;
  currentStage: ProcedureStage | null;
  compact?: boolean;
  cellClassName?: string;
  layout: "overview" | "board-card";
  attachmentsFor?: (column: ProcedureColumnKey) => StageCellAttachments | undefined;
  onChange: (column: ProcedureColumnKey, next: string) => void;
}) {
  return (
    <div
      className={cn(
        layout === "overview"
          ? "grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:gap-2"
          : "grid grid-cols-2 gap-3",
      )}
    >
      {PROCEDURE_COLUMNS.map((column) => (
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
            canEdit={canEdit}
            isCurrent={currentStage === column.stage}
            compact={compact}
            className={cellClassName}
            onChange={(next) => onChange(column.key, next)}
            attachments={attachmentsFor?.(column.key)}
          />
        </div>
      ))}
    </div>
  );
}
