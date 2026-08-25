import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DISCLOSURE_STATUSES,
  NEXT_DATE_FILTERS,
  NEXT_DATE_LABELS,
  PROCEDURE_STAGE_LABELS,
  PROCEDURE_STAGES,
  PROCEDURE_VALUE_LABELS,
  TRIAL_STATUSES,
  activeProcedureFilterCount,
  hasActiveProcedureFilters,
  toggleFilterValue,
  type ProcedureFilters,
} from "@/lib/docket-procedure";
import { cn } from "@/lib/utils";

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "min-h-8 touch-manipulation rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        selected
          ? "border-white/40 bg-white text-black"
          : "border-white/15 bg-white/5 text-white/75 hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wide text-white/45">
        {label}
      </span>
      {children}
    </div>
  );
}

export function DocketStageFilters({
  filters,
  onChange,
}: {
  filters: ProcedureFilters;
  onChange: (next: ProcedureFilters) => void;
}) {
  const active = hasActiveProcedureFilters(filters);
  const count = activeProcedureFilterCount(filters);
  const [expanded, setExpanded] = useState(false);

  const clearButton = active ? (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 text-xs text-white/70"
      onClick={() =>
        onChange({
          stages: [],
          custody: [],
          disclosure: [],
          trial: [],
          nextDate: [],
        })
      }
    >
      Clear filters
    </Button>
  ) : null;

  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-white/80"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          Filters
          {count > 0 && (
            <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[11px] text-white">
              {count}
            </span>
          )}
          <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
        </button>
        {clearButton}
      </div>
      <div className={cn("space-y-2", !expanded && "hidden")}>
        <ChipGroup label="Stage">
          {PROCEDURE_STAGES.map((stage) => (
            <Chip
              key={stage}
              selected={filters.stages.includes(stage)}
              onClick={() =>
                onChange({ ...filters, stages: toggleFilterValue(filters.stages, stage) })
              }
            >
              {PROCEDURE_STAGE_LABELS[stage]}
            </Chip>
          ))}
        </ChipGroup>
        <ChipGroup label="Custody">
          <Chip
            selected={filters.custody.includes("on_bail")}
            onClick={() =>
              onChange({ ...filters, custody: toggleFilterValue(filters.custody, "on_bail") })
            }
          >
            On bail
          </Chip>
          <Chip
            selected={filters.custody.includes("remanded")}
            onClick={() =>
              onChange({ ...filters, custody: toggleFilterValue(filters.custody, "remanded") })
            }
          >
            Remanded
          </Chip>
        </ChipGroup>
        <ChipGroup label="Disclosure">
          {DISCLOSURE_STATUSES.map((value) => (
            <Chip
              key={value}
              selected={filters.disclosure.includes(value)}
              onClick={() =>
                onChange({
                  ...filters,
                  disclosure: toggleFilterValue(filters.disclosure, value),
                })
              }
            >
              {PROCEDURE_VALUE_LABELS[value]}
            </Chip>
          ))}
        </ChipGroup>
        <ChipGroup label="Trial">
          {TRIAL_STATUSES.map((value) => (
            <Chip
              key={value}
              selected={filters.trial.includes(value)}
              onClick={() =>
                onChange({ ...filters, trial: toggleFilterValue(filters.trial, value) })
              }
            >
              {PROCEDURE_VALUE_LABELS[value]}
            </Chip>
          ))}
        </ChipGroup>
        <div className="flex flex-wrap items-center gap-2">
          <ChipGroup label="Next date">
            {NEXT_DATE_FILTERS.map((value) => (
              <Chip
                key={value}
                selected={filters.nextDate.includes(value)}
                onClick={() =>
                  onChange({
                    ...filters,
                    nextDate: toggleFilterValue(filters.nextDate, value),
                  })
                }
              >
                {NEXT_DATE_LABELS[value]}
              </Chip>
            ))}
          </ChipGroup>
        </div>
      </div>
    </div>
  );
}
