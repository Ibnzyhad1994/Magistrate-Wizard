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
import { NextDateCell } from "@/pages/docket/next-date-cell";
import {
  appearanceHintForColumn,
  currentStage,
  PROCEDURE_COLUMNS,
  type ProcedureColumnKey,
  type ProcedureSnapshot,
} from "@/lib/docket-procedure";
import { ROUTES } from "@/routes/paths";
import type { DocketMatterBoardRow } from "@/hooks/docket/use-docket-matters";
import { useUploadDocument } from "@/hooks/use-documents";
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

/** purpose isn't a ProcedureColumnKey property — this maps the two columns that carry a file attachment to the `documents.purpose` value that tags it (0074). */
const ATTACHMENT_PURPOSE: Partial<Record<ProcedureColumnKey, "ruling" | "judgment">> = {
  ruling_status: "ruling",
  judgment_status: "judgment",
};

/** One board row — a real component (not inlined in .map()) so each matter gets its own `useUploadDocument` mutation instance for its Ruling/Judgment "Attach file…" action. */
function DocketStageRow({
  row,
  stage,
  onPatch,
  onLogAppearance,
}: {
  row: DocketMatterBoardRow;
  stage: ReturnType<typeof currentStage>;
  onPatch: (id: string, values: TablesUpdate<"docket_matters">) => Promise<unknown>;
  onLogAppearance: (request: LogAppearanceRequest) => void;
}) {
  const uploadRuling = useUploadDocument("docket_matter", row.id);
  const uploadJudgment = useUploadDocument("docket_matter", row.id);
  const caseColBase =
    "sticky left-0 w-[8.75rem] max-w-[8.75rem] overflow-hidden bg-[#181818] shadow-[2px_0_0_0_rgba(255,255,255,0.08)] sm:w-56 sm:max-w-56 md:w-[14rem] md:max-w-[14rem]";

  async function handleChange(column: ProcedureColumnKey, next: string) {
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
    <TableRow>
      <TableCell className={`${caseColBase} z-20`}>
        <Link to={ROUTES.docketMatter(row.id)} className="block min-w-0 hover:underline">
          <p className="truncate text-xs font-semibold text-white/55">{row.case_number}</p>
          <p className="truncate text-sm text-white">{row.matter_title}</p>
          {row.charge_or_issue && (
            <p className="hidden truncate text-xs text-white/45 sm:block">{row.charge_or_issue}</p>
          )}
          {/* Only populated when a date filter is active (0080) — this
              date's own appearance status, e.g. this matter was heard and
              adjourned FROM this date, not necessarily its current
              overall status. */}
          {row.appearance_status && (
            <span
              className={`mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                row.appearance_status === "scheduled"
                  ? "bg-primary/20 text-primary"
                  : row.appearance_status === "completed"
                    ? "bg-white/10 text-white/60"
                    : "bg-white/5 text-white/40"
              }`}
            >
              {row.appearance_status === "scheduled"
                ? "Scheduled"
                : row.appearance_status === "completed"
                  ? "Heard / Adjourned"
                  : "Rescheduled"}
            </span>
          )}
        </Link>
      </TableCell>
      {PROCEDURE_COLUMNS.map((column) => {
        const purpose = ATTACHMENT_PURPOSE[column.key];
        const uploadMutation = purpose === "ruling" ? uploadRuling : purpose === "judgment" ? uploadJudgment : null;
        return (
          <TableCell key={column.key} className="p-1.5">
            <DocketStageCell
              column={column.key}
              value={String(row[column.key] ?? column.emptyValue)}
              canEdit={row.can_edit}
              isCurrent={stage === column.stage}
              onChange={(next) => void handleChange(column.key, next)}
              attachments={
                purpose && uploadMutation && row.can_edit
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
      <TableCell className="whitespace-nowrap">
        <NextDateCell matterId={row.id} nextDate={row.next_appearance} canEdit={row.can_edit} />
      </TableCell>
    </TableRow>
  );
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
  const caseColBase =
    "sticky left-0 w-[8.75rem] max-w-[8.75rem] overflow-hidden bg-[#181818] shadow-[2px_0_0_0_rgba(255,255,255,0.08)] sm:w-56 sm:max-w-56 md:w-[14rem] md:max-w-[14rem]";

  return (
    <div className="relative">
      <p className="mb-2 text-xs text-white/50 sm:hidden">
        Swipe sideways for the stage columns.
      </p>
      <div className="relative rounded-sm border border-white/10 [&>div]:max-h-[min(28rem,58dvh)] sm:[&>div]:max-h-none">
        <Table className="min-w-[56rem] border-separate border-spacing-0 sm:min-w-[72rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={`${caseColBase} z-30`}>Case</TableHead>
              {PROCEDURE_COLUMNS.map((column) => (
                <TableHead
                  key={column.key}
                  className="sticky top-0 z-20 min-w-[5.75rem] whitespace-nowrap bg-[#181818] sm:min-w-[7rem]"
                >
                  {column.label}
                </TableHead>
              ))}
              <TableHead className="sticky top-0 z-20 min-w-[6.5rem] whitespace-nowrap bg-[#181818] sm:min-w-[7.5rem]">
                Next date
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <DocketStageRow
                key={row.id}
                row={row}
                stage={currentStage(snapshotOf(row))}
                onPatch={onPatch}
                onLogAppearance={onLogAppearance}
              />
            ))}
          </TableBody>
        </Table>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-px right-px w-8 rounded-r-sm bg-gradient-to-l from-[#181818] to-transparent sm:hidden"
        />
      </div>
    </div>
  );
}
