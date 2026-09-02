import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocketStageCell, type StageCellAttachments } from "@/pages/docket/docket-stage-cell";
import {
  appearanceHintForColumn,
  matterCurrentStage,
  PROCEDURE_COLUMNS,
  type ProcedureColumnKey,
} from "@/lib/docket-procedure";
import { ProcedureColumnHeading } from "@/pages/docket/procedure-column-heading";
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
    try {
      await onPatch({ [column]: next }, matter.updated_at);
      const hint = appearanceHintForColumn(column, next);
      toast.success("Logged on the board.", {
        action: {
          label: "Log appearance",
          onClick: () => onLogAppearance(hint),
        },
      });
    } catch {
      // Mutation cache toast subscriber.
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
          Where this file is. Click a cell to record the result. Next date and
          Hearing progress sit on this Overview. Ruling and Judgment cells can
          also attach the actual document, separate from the Judgments tab,
          which is for a magistrate's own written judgments.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:gap-2">
          {PROCEDURE_COLUMNS.map((column) => (
            <div key={column.key} className="min-w-0 space-y-1 sm:min-w-[6.5rem]">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <ProcedureColumnHeading columnKey={column.key} label={column.label} />
              </p>
              <DocketStageCell
                column={column.key}
                value={String(matter[column.key] ?? column.emptyValue)}
                canEdit={canEdit}
                isCurrent={stage === column.stage}
                compact
                onChange={(next) => void handleChange(column.key, next)}
                attachments={attachmentsFor(column.key)}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
