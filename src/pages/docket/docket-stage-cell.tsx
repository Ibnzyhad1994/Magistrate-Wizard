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
    "inline-flex max-w-full touch-manipulation items-center rounded px-2 py-1 text-left text-xs font-medium",
    TONE_CLASS[tone],
    isCurrent && "ring-1 ring-white/45",
    compact ? "min-h-8" : "min-h-9 min-w-[5.5rem] sm:min-h-7",
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
