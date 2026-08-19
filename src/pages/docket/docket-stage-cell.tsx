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

const TONE_CLASS: Record<ReturnType<typeof procedureCellTone>, string> = {
  muted: "text-white/40",
  progress: "bg-amber-400/15 text-amber-200",
  done: "bg-emerald-400/15 text-emerald-200",
  remand: "bg-rose-400/20 text-rose-200",
};

export function DocketStageCell({
  column,
  value,
  canEdit,
  isCurrent,
  compact,
  onChange,
}: {
  column: ProcedureColumnKey;
  value: string;
  canEdit: boolean;
  isCurrent?: boolean;
  compact?: boolean;
  onChange: (next: string) => void;
}) {
  const mode = procedureCellMode(canEdit);
  const tone = procedureCellTone(column, value);
  const label = procedureCellLabel(value);
  const className = cn(
    "inline-flex max-w-full items-center rounded px-1.5 py-0.5 text-left text-xs font-medium",
    TONE_CLASS[tone],
    isCurrent && "ring-1 ring-white/45",
    compact ? "min-h-6" : "min-h-7 min-w-[5.5rem]",
    mode === "edit" && "cursor-pointer hover:brightness-110",
  );

  if (mode === "read") {
    return (
      <span className={className} title={label}>
        {label}
      </span>
    );
  }

  const options = procedureSelectableValues(column);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={className} aria-label={`${column.replace(/_/g, " ")}: ${label}`}>
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[9rem]">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {procedureHasClear(column) && value !== procedureEmptyValue(column) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(procedureEmptyValue(column))}>
              Clear
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
