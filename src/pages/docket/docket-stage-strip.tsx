import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type StageCellAttachments } from "@/pages/docket/docket-stage-cell";
import { ProcedureStageGrid } from "@/pages/docket/procedure-stage-grid";
import { DocketOutcomeCell } from "@/pages/docket/docket-outcome-cell";
import { protocolColumns, type ProcedureColumnKey } from "@/lib/docket-procedure";
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
import { getDocumentDownloadUrl, useDocuments, useUploadDocument } from "@/hooks/use-documents";
import { getErrorMessage } from "@/lib/utils";
import type { DocketMatter, Json, TablesUpdate } from "@/types/database.types";

const ATTACHMENT_PURPOSE: Partial<Record<ProcedureColumnKey, "ruling" | "judgment">> = {
  ruling_status: "ruling",
  judgment_status: "judgment",
};

export type OverviewLogAppearance = {
  event_type: string;
  stage_at_event: string;
  notes: string;
};

export function DocketStageStrip({
  matter,
  canEdit,
  categoryName,
  onPatch,
  onLogAppearance,
}: {
  matter: DocketMatter;
  canEdit: boolean;
  categoryName?: string | null;
  onPatch: (
    values: TablesUpdate<"docket_matters">,
    expectedUpdatedAt: string | null,
  ) => Promise<unknown>;
  onLogAppearance: (hint: OverviewLogAppearance) => void;
}) {
  const protocol = matterProtocol({
    workflow_protocol: matter.workflow_protocol,
    category_name: categoryName,
  });
  const stage = matterProtocolStage({ ...matter, category_name: categoryName });
  const columns = protocolColumns(protocol);
  const { data: documents } = useDocuments("docket_matter", matter.id);
  const uploadRuling = useUploadDocument("docket_matter", matter.id);
  const uploadJudgment = useUploadDocument("docket_matter", matter.id);

  async function handleChange(column: ProcedureColumnKey, next: string) {
    const previous = boardCellValue({ ...matter, category_name: categoryName }, column);
    await logProcedurePatch({
      column,
      previous,
      next,
      expectedUpdatedAt: matter.updated_at,
      patchValues: boardColumnPatch(column, next, categoryName),
      undoValues: boardColumnPatch(column, previous, categoryName),
      patch: (values, expectedUpdatedAt) => onPatch(values as TablesUpdate<"docket_matters">, expectedUpdatedAt),
      onLogAppearance,
    });
  }

  async function handleOutcomeChange(next: string | null) {
    try {
      await onPatch(outcomeBoardPatch(next), matter.updated_at);
      toast.success(next ? "Outcome updated." : "Outcome cleared.");
    } catch {
      // Surfaced globally via the mutation cache toast subscriber.
    }
  }

  async function handleDownload(filePath: string) {
    try {
      const url = await getDocumentDownloadUrl(filePath);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  function attachmentsFor(column: ProcedureColumnKey): StageCellAttachments | undefined {
    const purpose = ATTACHMENT_PURPOSE[column];
    if (!purpose || !canEdit) return undefined;
    const files = (documents ?? []).filter((d) => d.purpose === purpose);
    const uploadMutation = purpose === "ruling" ? uploadRuling : uploadJudgment;
    return {
      hasFile: files.length > 0,
      isUploading: uploadMutation.isPending,
      onUpload: (file) => uploadMutation.mutate({ file, purpose }),
      files: files.map((f) => ({
        id: f.id,
        file_name: f.file_name,
        onDownload: () => void handleDownload(f.file_path),
      })),
    };
  }

  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle className="text-base">Procedure</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Where this file is. Click a cell to record the result. Outcome, Next
          date, and Hearing progress sit on this Overview. Ruling and Judgment
          cells can also attach the actual document, separate from the
          Judgments tab, which is for a magistrate's own written judgments.
        </p>
        <ProcedureStageGrid
          layout="overview"
          compact
          columns={columns}
          protocol={protocol}
          categoryName={categoryName}
          currentStage={stage}
          canEdit={canEdit}
          getValue={(column) => boardCellValue({ ...matter, category_name: categoryName }, column)}
          adjournmentFor={(column) => {
            const current = adjournmentForStage(matter.stage_adjournments, column.stage);
            return {
              ...current,
              onSave: (adjourned, reason) => {
                const next = mergeStageAdjournment(
                  matter.stage_adjournments,
                  column.stage,
                  adjourned,
                  reason,
                );
                void onPatch({ stage_adjournments: next as Json }, matter.updated_at);
              },
            };
          }}
          attachmentsFor={attachmentsFor}
          onChange={(column, next) => void handleChange(column, next)}
        />
        <div className="mt-3 min-w-0 space-y-1 sm:max-w-[6.5rem]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Outcome
          </p>
          <DocketOutcomeCell
            value={matter.outcome_status}
            outcomeAdjourned={matter.outcome_adjourned}
            protocol={protocol}
            canEdit={canEdit}
            onChange={(next) => void handleOutcomeChange(next)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
