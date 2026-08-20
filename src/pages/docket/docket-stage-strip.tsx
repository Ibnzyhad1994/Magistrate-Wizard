import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocketStageCell, type StageCellAttachments } from "@/pages/docket/docket-stage-cell";
import {
  appearanceHintForColumn,
  currentStage,
  PROCEDURE_COLUMNS,
  type ProcedureColumnKey,
  type ProcedureSnapshot,
} from "@/lib/docket-procedure";
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

function snapshotOf(matter: DocketMatter): ProcedureSnapshot {
  return {
    arraignment_status: matter.arraignment_status as ProcedureSnapshot["arraignment_status"],
    custody_status: matter.custody_status as ProcedureSnapshot["custody_status"],
    disclosure_status: matter.disclosure_status as ProcedureSnapshot["disclosure_status"],
    trial_status: matter.trial_status as ProcedureSnapshot["trial_status"],
    ruling_status: matter.ruling_status as ProcedureSnapshot["ruling_status"],
    judgment_status: matter.judgment_status as ProcedureSnapshot["judgment_status"],
    sentence_status: matter.sentence_status as ProcedureSnapshot["sentence_status"],
    appeal_status: matter.appeal_status as ProcedureSnapshot["appeal_status"],
  };
}

export function DocketStageStrip({
  matter,
  canEdit,
  onPatch,
  onLogAppearance,
}: {
  matter: DocketMatter;
  canEdit: boolean;
  onPatch: (values: Partial<Record<ProcedureColumnKey, string>>) => Promise<unknown>;
  onLogAppearance: (hint: OverviewLogAppearance) => void;
}) {
  const stage = currentStage(snapshotOf(matter));
  const { data: documents } = useDocuments("docket_matter", matter.id);
  const uploadRuling = useUploadDocument("docket_matter", matter.id);
  const uploadJudgment = useUploadDocument("docket_matter", matter.id);

  async function handleChange(column: ProcedureColumnKey, next: string) {
    try {
      await onPatch({ [column]: next });
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
          Where this file is. Click a cell to record the result. Dates still go on Events.
          Ruling/Judgment cells can also attach the actual document — separate from the
          Judgments tab, which is for a magistrate's own written judgments.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:gap-2">
          {PROCEDURE_COLUMNS.map((column) => (
            <div key={column.key} className="min-w-0 space-y-1 sm:min-w-[6.5rem]">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {column.label}
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
