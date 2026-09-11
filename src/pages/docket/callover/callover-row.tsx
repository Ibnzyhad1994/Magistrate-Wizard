import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { HintTooltip } from "@/components/ui/tooltip";
import { NextDateDialog } from "@/pages/docket/next-date-cell";
import { useUpdateDocketMatter } from "@/hooks/docket/use-docket-matters";
import {
  CALLOVER_OUTCOME_VALUES,
  outcomeSuggestsCompletion,
} from "@/lib/callover";
import { procedureStageLabel } from "@/lib/docket-procedure";
import { NOT_SET } from "@/lib/empty-display";
import { ROUTES } from "@/routes/paths";
import { formatDate } from "@/lib/utils";
import type { TablesUpdate } from "@/types/database.types";

const OTHER = "__other__";

export type CalloverRowData = {
  id: string;
  sort_order: number;
  called_at: string | null;
  outcome: string | null;
  next_date: string | null;
  notes: string | null;
  docket_matter_id: string;
  docket_matters: {
    id: string;
    case_number: string;
    matter_title: string;
    charge_or_issue: string | null;
    status: string;
    procedure_stage: string | null;
    category_id: string | null;
    brought_forward_from: string | null;
  } | null;
};

/**
 * One matter on the running sheet. A real component (not inlined in a
 * `.map()`) so each row owns its own draft state — a magistrate typing a
 * note on row 12 must never have it discarded because row 3 refetched.
 *
 * Next dates are NOT written here. Pressing the date opens the shared
 * NextDateDialog, which writes through set_docket_matter_next_date() —
 * the same capacity-checked, adjournment-aware path the board and the
 * hearing dialog use. This row only mirrors the result for the record.
 */
export function CalloverRow({
  row,
  editable,
  onPatch,
  onRemove,
}: {
  row: CalloverRowData;
  editable: boolean;
  onPatch: (id: string, values: TablesUpdate<"docket_callover_items">) => void;
  onRemove: (id: string) => void;
}) {
  const matter = row.docket_matters;
  // Per-row mutation instance, matching DocketStageRow's own reason for
  // being a real component: useUpdateDocketMatter is keyed by matter id,
  // so each row needs its own.
  const updateMatter = useUpdateDocketMatter(row.docket_matter_id);
  const [dateOpen, setDateOpen] = useState(false);
  const [notes, setNotes] = useState(row.notes ?? "");
  // Free text is a first-class option (the column is unconstrained on
  // purpose), so an outcome the list doesn't know still round-trips.
  const isKnown = !row.outcome || CALLOVER_OUTCOME_VALUES.includes(row.outcome);
  const [freeText, setFreeText] = useState(isKnown ? "" : (row.outcome ?? ""));
  const [showFreeText, setShowFreeText] = useState(!isKnown);

  const stage = matter?.procedure_stage ?? null;
  const called = row.called_at !== null;

  function handleOutcome(value: string) {
    if (value === OTHER) {
      setShowFreeText(true);
      return;
    }
    setShowFreeText(false);
    setFreeText("");
    onPatch(row.id, {
      outcome: value || null,
      // Choosing an outcome IS calling the matter — stamping called_at
      // here saves a second click on every row of a thirty-matter list.
      called_at: value ? (row.called_at ?? new Date().toISOString()) : row.called_at,
    });
  }

  return (
    <>
      <TableRow className={called ? "opacity-70" : undefined}>
        <TableCell className="sticky left-0 z-20 w-[9rem] max-w-[9rem] overflow-hidden bg-card shadow-[2px_0_0_0_hsl(var(--foreground)/0.08)] sm:w-56 sm:max-w-56">
          <Link
            to={ROUTES.docketMatter(row.docket_matter_id)}
            className="block min-w-0 hover:underline"
          >
            <p className="truncate text-xs font-semibold text-foreground/55">
              {matter?.case_number ?? "—"}
            </p>
            <p className="truncate text-sm text-foreground">{matter?.matter_title ?? "Matter"}</p>
            {matter?.charge_or_issue && (
              <p className="hidden truncate text-xs text-foreground/45 sm:block">
                {matter.charge_or_issue}
              </p>
            )}
            {matter?.brought_forward_from && (
              <span className="mt-0.5 inline-block truncate rounded-[2px] border border-foreground/20 bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/80">
                Brought forward
              </span>
            )}
          </Link>
        </TableCell>

        <TableCell className="whitespace-nowrap text-xs text-foreground/70">
          {stage ? procedureStageLabel(stage) : NOT_SET}
        </TableCell>

        <TableCell className="min-w-[10rem] p-1.5">
          <Select
            value={showFreeText ? OTHER : (row.outcome ?? "")}
            onChange={(e) => handleOutcome(e.target.value)}
            disabled={!editable}
            aria-label={`Outcome for ${matter?.case_number ?? "matter"}`}
          >
            <option value="">Not recorded</option>
            {CALLOVER_OUTCOME_VALUES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
            <option value={OTHER}>Other…</option>
          </Select>
          {showFreeText && (
            <Input
              className="mt-1.5"
              placeholder="Describe the outcome"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              onBlur={() => {
                const trimmed = freeText.trim();
                if (trimmed === (row.outcome ?? "")) return;
                onPatch(row.id, {
                  outcome: trimmed || null,
                  called_at: trimmed ? (row.called_at ?? new Date().toISOString()) : row.called_at,
                });
              }}
              disabled={!editable}
              aria-label="Other outcome"
            />
          )}
          {outcomeSuggestsCompletion(row.outcome) && matter?.status === "active" && editable && (
            // Never automatic: an outcome does not mutate the matter's own
            // status by itself (0129). This is the explicit opt-in.
            <Button
              size="sm"
              variant="ghost"
              className="mt-1.5 h-auto px-1.5 py-1 text-[11px]"
              onClick={() => updateMatter.mutate({ values: { status: "completed" } })}
              disabled={updateMatter.isPending}
            >
              <Check className="h-3 w-3" />
              Also mark matter completed
            </Button>
          )}
        </TableCell>

        <TableCell className="whitespace-nowrap">
          {editable ? (
            <HintTooltip
              label={
                row.next_date
                  ? `Change next date, currently ${formatDate(row.next_date)}`
                  : "Set the next hearing date"
              }
            >
              <button
                type="button"
                onClick={() => setDateOpen(true)}
                className="whitespace-nowrap rounded px-1.5 py-1 text-left text-xs font-medium text-foreground/70 underline decoration-dotted underline-offset-2 hover:bg-foreground/10 hover:text-foreground"
              >
                {row.next_date ? formatDate(row.next_date) : "+ Set date"}
              </button>
            </HintTooltip>
          ) : (
            <span className="text-xs text-foreground/70">
              {row.next_date ? formatDate(row.next_date) : NOT_SET}
            </span>
          )}
        </TableCell>

        <TableCell className="min-w-[12rem] p-1.5">
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes === (row.notes ?? "")) return;
              onPatch(row.id, { notes: notes || null });
            }}
            placeholder="Notes"
            disabled={!editable}
            aria-label={`Notes for ${matter?.case_number ?? "matter"}`}
          />
        </TableCell>

        <TableCell className="whitespace-nowrap">
          {editable && !called && (
            <HintTooltip label="Remove from this callover">
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => onRemove(row.id)}
                aria-label="Remove from this callover"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </HintTooltip>
          )}
          {called && (
            <span className="text-[11px] text-foreground/45">
              {/* Once called, the row is part of the sitting's record and
                  the database refuses to delete it (0129). */}
              Called
            </span>
          )}
        </TableCell>
      </TableRow>

      {dateOpen && (
        <NextDateDialog
          matterId={row.docket_matter_id}
          currentDate={row.next_date}
          matterCategoryId={matter?.category_id ?? null}
          onClose={() => setDateOpen(false)}
          onSaved={(date) =>
            onPatch(row.id, {
              next_date: date,
              called_at: row.called_at ?? new Date().toISOString(),
            })
          }
        />
      )}
    </>
  );
}
