import { useRef } from "react";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
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
  procedureCellLabel,
  procedureCellMode,
  procedureCellTone,
  procedureEmptyValue,
  procedureHasClear,
  procedureSelectableValues,
  type ProcedureColumnKey,
} from "@/lib/docket-procedure";
import { INGEST_FILE_ACCEPT } from "@/lib/ingest-source";

const TONE_CLASS: Record<ReturnType<typeof procedureCellTone>, string> = {
  muted: "text-white/40",
  progress: "bg-amber-400/15 text-amber-200",
  done: "bg-emerald-400/15 text-emerald-200",
  remand: "bg-rose-400/20 text-rose-200",
};

/** Ruling/Judgment-only: lets the cell attach the actual file, not just record a status (0074). */
export interface StageCellAttachments {
  hasFile: boolean;
  isUploading: boolean;
  onUpload: (file: File) => void;
  /** Per-file download actions — provided where full document metadata is already on hand (the matter detail page); omitted on the list/glance board, which only carries a boolean flag per row for performance. */
  files?: { id: string; file_name: string; onDownload: () => void }[];
}

export function DocketStageCell({
  column,
  value,
  canEdit,
  isCurrent,
  compact,
  onChange,
  attachments,
}: {
  column: ProcedureColumnKey;
  value: string;
  canEdit: boolean;
  isCurrent?: boolean;
  compact?: boolean;
  onChange: (next: string) => void;
  attachments?: StageCellAttachments;
}) {
  const mode = procedureCellMode(canEdit);
  const tone = procedureCellTone(column, value);
  const label = procedureCellLabel(value);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const className = cn(
    "inline-flex max-w-full touch-manipulation items-center gap-1 rounded px-2 py-1 text-left text-xs font-medium",
    TONE_CLASS[tone],
    isCurrent && "ring-1 ring-white/45",
    compact ? "min-h-8" : "min-h-9 min-w-[5.5rem] sm:min-h-7",
    mode === "edit" && "cursor-pointer hover:brightness-110",
  );

  const attachmentIcon = attachments?.hasFile && (
    <Paperclip className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
  );

  if (mode === "read") {
    return (
      <span className={className} title={label}>
        {label}
        {attachmentIcon}
      </span>
    );
  }

  const options = procedureSelectableValues(column);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={className}
          aria-label={`${column.replace(/_/g, " ")}: ${label}${attachments?.hasFile ? " (file attached)" : ""}`}
        >
          {label}
          {attachmentIcon}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" collisionPadding={16} className="min-w-[11rem]">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} className="min-h-10">
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
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
                ↓ {file.file_name}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
