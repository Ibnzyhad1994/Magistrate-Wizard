import { useRef, useState } from "react";
import { Download, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { HintTooltip } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BOARD_COLUMNS,
  isProcedureEmptyValue,
  procedureCellLabel,
  procedureCellMode,
  procedureCellTone,
  procedureEmptyValue,
  procedureHasClear,
  procedureSelectableValues,
  type ProcedureColumnKey,
  type WorkflowProtocol,
} from "@/lib/docket-procedure";
import { INGEST_FILE_ACCEPT } from "@/lib/ingest-source";
import { DECISION_GRANTED_STATUSES } from "@/lib/docket-procedure";
import {
  decisionAmountCaption,
  isProtectionCategory,
  type StageAdjournment,
} from "@/lib/docket-protocols";

const TONE_CLASS: Record<ReturnType<typeof procedureCellTone>, string> = {
  muted: "text-white/40",
  progress: "bg-[hsl(var(--stage-progress)/0.15)] text-[hsl(var(--stage-progress))]",
  done: "bg-[hsl(var(--stage-done)/0.15)] text-[hsl(var(--stage-done))]",
  remand: "bg-[hsl(var(--stage-remand)/0.20)] text-[hsl(var(--stage-remand))]",
};

/** Ruling/Judgment-only: lets the cell attach the actual file, not just record a status (0074). */
export interface StageCellAttachments {
  hasFile: boolean;
  isUploading: boolean;
  onUpload: (file: File) => void;
  /** Per-file download actions — provided where full document metadata is already on hand (the matter detail page); omitted on the list/glance board, which only carries a boolean flag per row for performance. */
  files?: { id: string; file_name: string; onDownload: () => void }[];
}

export type StageCellAdjournment = StageAdjournment & {
  onSave: (adjourned: boolean, reason: string) => void;
};

export function DocketStageCell({
  column,
  value,
  canEdit,
  isCurrent,
  compact,
  className,
  onChange,
  attachments,
  applicable = true,
  protocol,
  categoryName,
  adjournment,
}: {
  column: ProcedureColumnKey;
  value: string;
  canEdit: boolean;
  isCurrent?: boolean;
  compact?: boolean;
  className?: string;
  onChange: (next: string) => void;
  attachments?: StageCellAttachments;
  applicable?: boolean;
  protocol?: WorkflowProtocol;
  categoryName?: string | null;
  adjournment?: StageCellAdjournment;
}) {
  const columnMeta = BOARD_COLUMNS.find((item) => item.key === column);
  const mode = procedureCellMode(canEdit && applicable);
  const tone = applicable ? procedureCellTone(column, value) : "muted";
  const adjourned = adjournment?.adjourned === true;
  const baseLabel = applicable
    ? procedureCellLabel(value, { column, canEdit: canEdit && applicable, protocol })
    : "N/A";
  const label =
    applicable && adjourned
      ? isProcedureEmptyValue(value)
        ? "Adjourned"
        : `${baseLabel} · Adjourned`
      : baseLabel;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [amountDraft, setAmountDraft] = useState(value);
  const [reasonDraft, setReasonDraft] = useState(adjournment?.reason ?? "");
  const cellClassName = cn(
    "inline-flex max-w-full touch-manipulation items-center gap-1 rounded px-2 py-1 text-left text-xs font-medium",
    TONE_CLASS[tone],
    isCurrent && applicable && "ring-2 ring-[hsl(var(--match))]",
    compact ? "min-h-8" : "min-h-9 min-w-[5.5rem] sm:min-h-7",
    mode === "edit" && "cursor-pointer hover:brightness-110",
    !applicable && "cursor-default text-white/25",
    className,
  );
  const hint = !applicable
    ? "Not on this classification's board"
    : mode === "edit"
      ? tone === "muted"
        ? "Click to record this stage"
        : "Click to update this stage"
        : adjourned && adjournment?.reason
        ? `Adjourned: ${adjournment.reason}`
        : label;

  const attachmentIcon = attachments?.hasFile && (
    <Paperclip className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
  );

  if (!applicable) {
    return (
      <HintTooltip label={hint}>
        <span className={cellClassName} aria-label={`${column.replace(/_/g, " ")}: not on this board`}>
          N/A
        </span>
      </HintTooltip>
    );
  }

  if (mode === "read") {
    return (
      <HintTooltip label={hint}>
        <span className={cellClassName} aria-label={`${column.replace(/_/g, " ")}: ${label}`}>
          {label}
          {attachmentIcon}
        </span>
      </HintTooltip>
    );
  }

  const isDecision = columnMeta?.kind === "decision";
  const isProtection = isProtectionCategory(categoryName);
  const options = isDecision
    ? isProtection
      ? DECISION_GRANTED_STATUSES.map((status) => ({
          value: status,
          label: procedureCellLabel(status),
        }))
      : []
    : procedureSelectableValues(column, protocol);

  const adjournmentBlock = adjournment ? (
    <>
      <DropdownMenuSeparator />
      {adjournment.adjourned ? (
        <DropdownMenuItem className="min-h-10" onSelect={() => adjournment.onSave(false, "")}>
          Clear adjournment
        </DropdownMenuItem>
      ) : (
        <div className="space-y-1.5 px-2 py-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">Adjourn this stage</p>
          <Input
            value={reasonDraft}
            onChange={(e) => setReasonDraft(e.target.value)}
            placeholder="e.g. awaiting documentation"
            aria-label="Adjournment reason"
            className="h-8 text-xs"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <Button
            type="button"
            size="sm"
            className="h-8 w-full text-xs"
            onClick={() => adjournment.onSave(true, reasonDraft)}
          >
            Save adjournment
          </Button>
        </div>
      )}
      {adjournment.adjourned && adjournment.reason ? (
        <p className="px-2 pb-1.5 text-[11px] text-muted-foreground">{adjournment.reason}</p>
      ) : null}
    </>
  ) : null;

  if (isDecision && !isProtection) {
    return (
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) setAmountDraft(value);
        }}
      >
        <HintTooltip label={hint}>
          <span className="inline-flex max-w-full">
            <DropdownMenuTrigger asChild>
              <button type="button" className={cellClassName} aria-label={`Decision: ${label}`}>
                {label}
              </button>
            </DropdownMenuTrigger>
          </span>
        </HintTooltip>
        <DropdownMenuContent align="start" collisionPadding={16} className="min-w-[12rem] p-2">
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
            {decisionAmountCaption(categoryName)}
          </p>
          <Input
            type="number"
            inputMode="decimal"
            value={amountDraft}
            onChange={(e) => setAmountDraft(e.target.value)}
            aria-label={decisionAmountCaption(categoryName)}
            className="h-8 text-xs"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") onChange(amountDraft);
            }}
          />
          <Button
            type="button"
            size="sm"
            className="mt-2 h-8 w-full text-xs"
            onClick={() => onChange(amountDraft)}
          >
            Save
          </Button>
          {value && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-1 h-8 w-full text-xs"
              onClick={() => onChange("")}
            >
              Clear
            </Button>
          )}
          {adjournmentBlock}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) setReasonDraft(adjournment?.reason ?? "");
      }}
    >
      <HintTooltip label={hint}>
        <span className="inline-flex max-w-full">
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cellClassName}
              aria-label={`${column.replace(/_/g, " ")}: ${label}${attachments?.hasFile ? " (file attached)" : ""}`}
            >
              {label}
              {attachmentIcon}
            </button>
          </DropdownMenuTrigger>
        </span>
      </HintTooltip>
      <DropdownMenuContent align="start" collisionPadding={16} className="min-w-[11rem]">
        {options.length > 0 && (
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value} className="min-h-10">
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
        {procedureHasClear(column) && value !== procedureEmptyValue(column) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="min-h-10"
              onSelect={() => onChange(procedureEmptyValue(column))}
            >
              Clear
            </DropdownMenuItem>
          </>
        )}
        {attachments && (
          <>
            <DropdownMenuSeparator />
            {attachments.files?.map((file) => (
              <DropdownMenuItem
                key={file.id}
                className="min-h-10 truncate"
                onSelect={() => file.onDownload()}
              >
                <Download className="h-3.5 w-3.5" />
                {file.file_name}
              </DropdownMenuItem>
            ))}
            <input
              ref={fileInputRef}
              type="file"
              accept={INGEST_FILE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) attachments.onUpload(file);
                e.target.value = "";
              }}
            />
            <DropdownMenuItem
              className="min-h-10"
              disabled={attachments.isUploading}
              onSelect={(e) => {
                e.preventDefault();
                fileInputRef.current?.click();
              }}
            >
              <Paperclip className="h-3.5 w-3.5" />
              {attachments.isUploading
                ? "Uploading…"
                : attachments.hasFile
                  ? "Attach another file…"
                  : "Attach file…"}
            </DropdownMenuItem>
          </>
        )}
        {adjournmentBlock}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

