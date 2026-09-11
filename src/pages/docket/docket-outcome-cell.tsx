import { cn } from "@/lib/utils";
import { HintTooltip } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NOT_SET } from "@/lib/empty-display";
import {
  CIVIL_OUTCOME_ADJOURNED,
  outcomeLabel,
  outcomeOptionsForProtocol,
  outcomeTone,
  type OutcomeTone,
} from "@/lib/docket-outcome";
import type { WorkflowProtocol } from "@/lib/docket-procedure";

const TONE_CLASS: Record<OutcomeTone, string> = {
  muted: "text-foreground/40",
  dismissed: "bg-[hsl(var(--stage-dismissed)/0.15)] text-[hsl(var(--stage-dismissed))]",
  complete: "bg-[hsl(var(--stage-outcome-complete)/0.15)] text-[hsl(var(--stage-outcome-complete))]",
  adjourned: "bg-[hsl(var(--stage-progress)/0.15)] text-[hsl(var(--stage-progress))]",
};

/**
 * The board's Outcome cell. Criminal Trial: Dismissed / Completed (0131).
 * Paper Committal: Completed only. Civil summons: Completed / Adjourned,
 * where Adjourned is not stored on outcome_status.
 */
export function DocketOutcomeCell({
  value,
  canEdit,
  onChange,
  protocol = "criminal_trial",
  outcomeAdjourned = false,
}: {
  value: string | null;
  canEdit: boolean;
  onChange: (next: string | null) => void;
  protocol?: WorkflowProtocol;
  outcomeAdjourned?: boolean;
}) {
  const options = outcomeOptionsForProtocol(protocol);
  const displayValue = outcomeAdjourned && !value ? CIVIL_OUTCOME_ADJOURNED : value;
  const tone = outcomeTone(value, outcomeAdjourned);
  const label = outcomeLabel(value, outcomeAdjourned);
  const cellClassName = cn(
    "inline-flex max-w-full touch-manipulation items-center gap-1 rounded px-2 py-1 text-left text-xs font-medium",
    TONE_CLASS[tone],
    "min-h-9 min-w-[5.5rem] sm:min-h-7",
    canEdit && "cursor-pointer hover:brightness-110",
  );

  if (!canEdit) {
    return (
      <HintTooltip label={label}>
        <span className={cellClassName} aria-label={`Outcome: ${displayValue ? label : NOT_SET}`}>
          {displayValue ? label : NOT_SET}
        </span>
      </HintTooltip>
    );
  }

  const hint = displayValue ? "Click to change the outcome" : "Click to record an outcome";

  return (
    <DropdownMenu>
      <HintTooltip label={hint}>
        <span className="inline-flex max-w-full">
          <DropdownMenuTrigger asChild>
            <button type="button" className={cellClassName} aria-label={`Outcome: ${displayValue ? label : NOT_SET}`}>
              {displayValue ? label : NOT_SET}
            </button>
          </DropdownMenuTrigger>
        </span>
      </HintTooltip>
      <DropdownMenuContent align="start" collisionPadding={16} className="min-w-[11rem]">
        <DropdownMenuRadioGroup
          value={displayValue ?? ""}
          onValueChange={(next) => onChange(next || null)}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} className="min-h-10">
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {displayValue && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-10" onSelect={() => onChange(null)}>
              Clear
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
