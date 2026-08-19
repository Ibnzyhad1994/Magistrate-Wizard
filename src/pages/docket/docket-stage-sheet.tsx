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
import {
  appearanceHintForColumn,
  currentStage,
  PROCEDURE_COLUMNS,
  type ProcedureColumnKey,
  type ProcedureSnapshot,
} from "@/lib/docket-procedure";
import { formatDate } from "@/lib/utils";
import { ROUTES } from "@/routes/paths";
import type { DocketMatterBoardRow } from "@/hooks/docket/use-docket-matters";
import type { TablesUpdate } from "@/types/database.types";

export type LogAppearanceRequest = {
  matterId: string;
  event_type: string;
  stage_at_event: string;
  notes: string;
};

function snapshotOf(row: DocketMatterBoardRow): ProcedureSnapshot {
  return {
    arraignment_status: row.arraignment_status as ProcedureSnapshot["arraignment_status"],
    custody_status: row.custody_status as ProcedureSnapshot["custody_status"],
    disclosure_status: row.disclosure_status as ProcedureSnapshot["disclosure_status"],
    trial_status: row.trial_status as ProcedureSnapshot["trial_status"],
    ruling_status: row.ruling_status as ProcedureSnapshot["ruling_status"],
    judgment_status: row.judgment_status as ProcedureSnapshot["judgment_status"],
    sentence_status: row.sentence_status as ProcedureSnapshot["sentence_status"],
    appeal_status: row.appeal_status as ProcedureSnapshot["appeal_status"],
  };
}

export function DocketStageSheet({
  rows,
  onPatch,
  onLogAppearance,
}: {
  rows: DocketMatterBoardRow[];
  onPatch: (id: string, values: TablesUpdate<"docket_matters">) => Promise<unknown>;
  onLogAppearance: (request: LogAppearanceRequest) => void;
}) {
  async function handleChange(
    row: DocketMatterBoardRow,
    column: ProcedureColumnKey,
    next: string,
  ) {
    try {
      await onPatch(row.id, { [column]: next });
      const hint = appearanceHintForColumn(column, next);
      toast.success("Logged on the board.", {
        action: {
          label: "Log appearance",
          onClick: () =>
            onLogAppearance({
              matterId: row.id,
              ...hint,
            }),
        },
      });
    } catch {
      // Mutation cache toast subscriber.
    }
  }

  return (
    <div className="relative w-full overflow-auto rounded-sm border border-white/10">
      <Table className="min-w-[72rem] border-separate border-spacing-0">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 z-30 min-w-[14rem] bg-[#181818] shadow-[2px_0_0_0_rgba(255,255,255,0.08)]">
              Case
            </TableHead>
            {PROCEDURE_COLUMNS.map((column) => (
              <TableHead key={column.key} className="sticky top-0 z-20 min-w-[7rem] whitespace-nowrap bg-[#181818]">
                {column.label}
              </TableHead>
            ))}
            <TableHead className="sticky top-0 z-20 min-w-[7.5rem] whitespace-nowrap bg-[#181818]">
              Next date
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const stage = currentStage(snapshotOf(row));
            return (
              <TableRow key={row.id}>
                <TableCell className="sticky left-0 z-20 bg-[#181818] shadow-[2px_0_0_0_rgba(255,255,255,0.08)]">
                  <Link
                    to={ROUTES.docketMatter(row.id)}
                    className="block min-w-0 hover:underline"
                  >
                    <p className="truncate text-xs font-semibold text-white/55">{row.case_number}</p>
                    <p className="truncate text-sm text-white">{row.matter_title}</p>
                    {row.charge_or_issue && (
                      <p className="truncate text-xs text-white/45">{row.charge_or_issue}</p>
                    )}
                  </Link>
                </TableCell>
                {PROCEDURE_COLUMNS.map((column) => (
                  <TableCell key={column.key} className="p-1.5">
                    <DocketStageCell
                      column={column.key}
                      value={String(row[column.key] ?? column.emptyValue)}
                      canEdit={row.can_edit}
                      isCurrent={stage === column.stage}
                      onChange={(next) => void handleChange(row, column.key, next)}
                    />
                  </TableCell>
                ))}
                <TableCell className="whitespace-nowrap text-xs text-white/70">
                  {row.next_appearance ? formatDate(row.next_appearance) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
