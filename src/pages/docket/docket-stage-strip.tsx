import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type StageCellAttachments } from "@/pages/docket/docket-stage-cell";
import { ProcedureStageGrid } from "@/pages/docket/procedure-stage-grid";
import {
  matterCurrentStage,
  PROCEDURE_COLUMNS,
  type ProcedureColumnKey,
} from "@/lib/docket-procedure";
import { logProcedurePatch } from "@/lib/docket-procedure-log";
import { getDocumentDownloadUrl, useDocuments, useUploadDocument } from "@/hooks/use-documents";
import { getErrorMessage } from "@/lib/utils";
import type { DocketMatter } from "@/types/database.types";

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
  onPatch,
  onLogAppearance,
}: {
  matter: DocketMatter;
  canEdit: boolean;
  onPatch: (
    values: Partial<Record<ProcedureColumnKey, string>>,
    expectedUpdatedAt: string | null,
  ) => Promise<unknown>;
  onLogAppearance: (hint: OverviewLogAppearance) => void;
}) {
  const stage = matterCurrentStage(matter);
  const { data: documents } = useDocuments("docket_matter", matter.id);
  const uploadRuling = useUploadDocument("docket_matter", matter.id);
  const uploadJudgment = useUploadDocument("docket_matter", matter.id);

  async function handleChange(column: ProcedureColumnKey, next: string) {
    const meta = PROCEDURE_COLUMNS.find((item) => item.key === column);
    const previous = String(matter[column] ?? meta?.emptyValue ?? "");
    await logProcedurePatch({
      column,
      previous,
      next,
      expectedUpdatedAt: matter.updated_at,
      patch: (values, expectedUpdatedAt) => onPatch(values, expectedUpdatedAt),
      onLogAppearance,
    });
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
          Where this file is. Click a cell to record the result. Next date and
          Hearing progress sit on this Overview. Ruling and Judgment cells can
          also attach the actual document, separate from the Judgments tab,
          which is for a magistrate's own written judgments.
        </p>
        <ProcedureStageGrid
          layout="overview"
          compact
          currentStage={stage}
          canEdit={canEdit}
          getValue={(column) => {
            const meta = PROCEDURE_COLUMNS.find((item) => item.key === column);
            return String(matter[column] ?? meta?.emptyValue ?? "");
          }}
          attachmentsFor={attachmentsFor}
          onChange={(column, next) => void handleChange(column, next)}
        />
      </CardContent>
    </Card>
  );
}
