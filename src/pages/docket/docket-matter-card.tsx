import { Link } from "react-router-dom";
import { NextDateCell } from "@/pages/docket/next-date-cell";
import { ProcedureStageGrid } from "@/pages/docket/procedure-stage-grid";
import {
  currentStage,
  PROCEDURE_COLUMNS,
  type ProcedureColumnKey,
  type ProcedureSnapshot,
} from "@/lib/docket-procedure";
import { logProcedurePatch } from "@/lib/docket-procedure-log";
import { ROUTES } from "@/routes/paths";
import type { DocketMatterBoardRow } from "@/hooks/docket/use-docket-matters";
import { useUploadDocument } from "@/hooks/use-documents";
import type { TablesUpdate } from "@/types/database.types";
import { matterClassificationLabel } from "@/lib/validations/docket";
import type { LogAppearanceRequest } from "@/pages/docket/docket-stage-sheet";
import { Skeleton } from "@/components/ui/skeleton";

const ATTACHMENT_PURPOSE: Partial<Record<ProcedureColumnKey, "ruling" | "judgment">> = {
  ruling_status: "ruling",
  judgment_status: "judgment",
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

function AppearanceChip({ status, outcome }: { status: string; outcome: string | null }) {
  return (
    <span
      className={`mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        status === "scheduled"
          ? "bg-primary/20 text-primary"
          : status === "completed"
            ? "bg-white/10 text-white/60"
            : "bg-white/5 text-white/40"
      }`}
    >
      {status === "scheduled"
        ? "Scheduled"
        : status === "completed"
          ? outcome || "Heard / Adjourned"
          : "Rescheduled"}
    </span>
  );
}

export function DocketMatterCardSkeleton() {
  return (
    <div className="space-y-3 rounded-sm border border-white/10 bg-[#181818] p-3">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-5 w-3/4" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-11 w-full" />
        ))}
      </div>
    </div>
  );
}

export function DocketMatterCard({
  row,
  showCourt,
  isTourNextDate,
  onPatch,
  onLogAppearance,
}: {
  row: DocketMatterBoardRow;
  showCourt: boolean;
  isTourNextDate?: boolean;
  onPatch: (
    id: string,
    values: TablesUpdate<"docket_matters">,
    expectedUpdatedAt: string | null,
  ) => Promise<unknown>;
  onLogAppearance: (request: LogAppearanceRequest) => void;
}) {
  const uploadRuling = useUploadDocument("docket_matter", row.id);
  const uploadJudgment = useUploadDocument("docket_matter", row.id);
  const classification = matterClassificationLabel(row.category_name, row.category_other);
  const stage = currentStage(snapshotOf(row));

  const handleChange = (column: ProcedureColumnKey, next: string) => {
    const meta = PROCEDURE_COLUMNS.find((item) => item.key === column);
    const previous = String(row[column] ?? meta?.emptyValue ?? "");
    void logProcedurePatch({
      column,
      previous,
      next,
      expectedUpdatedAt: row.updated_at,
      patch: (values, expectedUpdatedAt) => onPatch(row.id, values, expectedUpdatedAt),
      onLogAppearance: (hint) => onLogAppearance({ matterId: row.id, ...hint }),
    });
  };

  const nextDate = (
    <NextDateCell
      matterId={row.id}
      nextDate={row.next_appearance}
      matterCategoryId={row.category_id}
      canEdit={row.can_edit}
    />
  );

  return (
    <article className="rounded-sm border border-white/10 bg-[#181818] p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <Link to={ROUTES.docketMatter(row.id)} className="min-w-0 hover:underline">
          <p className="truncate text-xs font-semibold text-white/55">{row.case_number}</p>
          <p className="text-sm text-white">{row.matter_title}</p>
          {classification && (
            <span className="mt-0.5 mr-1 inline-block truncate rounded-[2px] border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/80">
              {classification}
            </span>
          )}
          {showCourt && row.court_name && (
            <span className="mt-0.5 mr-1 inline-block truncate rounded-[2px] border border-white/20 bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/80">
              {row.court_name}
            </span>
          )}
          {row.appearance_status && (
            <AppearanceChip status={row.appearance_status} outcome={row.appearance_outcome} />
          )}
        </Link>
        <div className="shrink-0" data-tour={isTourNextDate ? "docket-next-date" : undefined}>
          {nextDate}
        </div>
      </div>
      <ProcedureStageGrid
        layout="board-card"
        compact
        cellClassName="min-h-11"
        currentStage={stage}
        canEdit={row.can_edit}
        getValue={(column) => {
          const meta = PROCEDURE_COLUMNS.find((item) => item.key === column);
          return String(row[column] ?? meta?.emptyValue ?? "");
        }}
        attachmentsFor={(column) => {
          const purpose = ATTACHMENT_PURPOSE[column];
          const uploadMutation = purpose === "ruling" ? uploadRuling : purpose === "judgment" ? uploadJudgment : null;
          if (!purpose || !uploadMutation || !row.can_edit) return undefined;
          return {
            hasFile: purpose === "ruling" ? row.has_ruling_document : row.has_judgment_document,
            isUploading: uploadMutation.isPending,
            onUpload: (file) => uploadMutation.mutate({ file, purpose }),
          };
        }}
        onChange={handleChange}
      />
    </article>
  );
}
