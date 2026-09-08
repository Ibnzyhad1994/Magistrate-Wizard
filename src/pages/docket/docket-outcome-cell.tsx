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
  OUTCOME_STATUSES,
  OUTCOME_VALUE_LABELS,
  outcomeLabel,
  outcomeTone,
  type OutcomeTone,
} from "@/lib/docket-outcome";

const TONE_CLASS: Record<OutcomeTone, string> = {
  muted: "text-white/40",
  dismissed: "bg-[hsl(var(--stage-dismissed)/0.15)] text-[hsl(var(--stage-dismissed))]",
  complete: "bg-[hsl(var(--stage-outcome-complete)/0.15)] text-[hsl(var(--stage-outcome-complete))]",
};

/**
 * The board's Outcome cell — a matter's disposition (Dismissed / Completed),
 * settable at any procedure stage. A dedicated component rather than a
 * `DocketStageCell` extension: that component is tightly typed to the
 * eight-key `ProcedureColumnKey` set (`docket-procedure.ts`), and Outcome
 * has a genuinely different, much smaller vocabulary (two values + clear)
 * and its own red/blue tone system rather than the stage cells' muted/
 * progress/done/remand palette.
 *
 * Setting a value writes through the ordinary board `onPatch`
 * (`docket-list-page.tsx` -> `usePatchDocketProcedure`, already generically
 * typed to `TablesUpdate<"docket_matters">`) and forces the matter's
 * `status` server-side via the `docket_matters_outcome_sync` trigger
 * (0131) — this component never touches `status` directly.
 */
export function DocketOutcomeCell({
  value,
  canEdit,
  onChange,
}: {
  value: string | null;
  canEdit: boolean;
  onChange: (next: string | null) => void;
}) {
  const tone = outcomeTone(value);
  const label = outcomeLabel(value);
  const cellClassName = cn(
    "inline-flex max-w-full touch-manipulation items-center gap-1 rounded px-2 py-1 text-left text-xs font-medium",
    TONE_CLASS[tone],
    "min-h-9 min-w-[5.5rem] sm:min-h-7",
    canEdit && "cursor-pointer hover:brightness-110",
  );

  if (!canEdit) {
    return (
      <HintTooltip label={label}>
        <span className={cellClassName} aria-label={`Outcome: ${value ? label : NOT_SET}`}>
          {value ? label : NOT_SET}
        </span>
      </HintTooltip>
    );
  }

  const hint = value ? "Click to change the outcome" : "Click to record an outcome";

  return (
    <DropdownMenu>
      <HintTooltip label={hint}>
        <span className="inline-flex max-w-full">
          <DropdownMenuTrigger asChild>
            <button type="button" className={cellClassName} aria-label={`Outcome: ${value ? label : NOT_SET}`}>
              {value ? label : NOT_SET}
            </button>
          </DropdownMenuTrigger>
        </span>
      </HintTooltip>
      <DropdownMenuContent align="start" collisionPadding={16} className="min-w-[11rem]">
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={(next) => onChange(next || null)}>
          {OUTCOME_STATUSES.map((status) => (
            <DropdownMenuRadioItem key={status} value={status} className="min-h-10">
              {OUTCOME_VALUE_LABELS[status]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {value && (
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
