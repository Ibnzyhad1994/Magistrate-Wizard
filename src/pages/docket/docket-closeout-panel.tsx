import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetailsHint } from "@/components/common/details-hint";
import {
  closeoutEntries,
  overnightWarning,
  reportWarning,
  summariseCloseout,
  type CloseoutRow,
} from "@/lib/docket-closeout";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

const STATE_LABEL = {
  no_outcome: "No outcome recorded",
  no_next_date: "No date after today",
  both: "No outcome, no next date",
  ready: "",
} as const;

/**
 * Reconciles the end of a sitting: what was listed today that still needs
 * something. Callovers are the running sheet DURING a sitting and the
 * dashboard already counts today's unlogged appearances -- what was
 * missing is an actionable list at the point of work, since that count
 * links only to the first matter.
 *
 * A panel on the date-filtered list rather than a third day-view route:
 * the date, court scope and rows are already resolved here, and two
 * surfaces for one day is already one more than ideal.
 */
export function DocketCloseoutPanel({
  rows,
  closingDate,
  onOpenMatter,
}: {
  rows: CloseoutRow[];
  closingDate: string;
  onOpenMatter: (matterId: string) => void;
}) {
  const entries = useMemo(() => closeoutEntries(rows, closingDate), [rows, closingDate]);
  const summary = useMemo(() => summariseCloseout(entries), [entries]);
  // Collapsed when the day is clean: a panel that says "nothing to do"
  // should not take up the space of one that does.
  const [open, setOpen] = useState(summary.needingAttention > 0);

  if (summary.total === 0) return null;

  const outstanding = entries.filter((entry) => entry.state !== "ready");
  const overnight = overnightWarning(summary);
  const report = reportWarning(summary);

  return (
    <section className="mb-4 rounded-md border border-hairline bg-card shadow-elevation-1 hc:border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-1.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="text-heading text-foreground">
            {summary.needingAttention === 0
              ? `Close out ${formatDate(closingDate)} — all ${summary.total} recorded`
              : `Close out ${formatDate(closingDate)} — ${summary.needingAttention} of ${summary.total} ${summary.needingAttention === 1 ? "needs" : "need"} attention`}
          </span>
        </button>
        <DetailsHint
          label="What this checks"
          details="Every matter listed on this date, from the same list shown below. A file needs attention when its appearance is still marked scheduled with no outcome recorded, or when nothing is scheduled after this day. It reads the outcome of the appearance, not the matter's overall outcome."
        />
      </div>

      {open && (
        <div className="space-y-3 border-t border-hairline px-3 pb-3 pt-3 hc:border-border">
          {overnight && <p className="text-sm text-warning">{overnight}</p>}
          {report && <p className="text-xs text-muted-foreground">{report}</p>}

          {outstanding.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every matter listed on this date has an outcome and a date after today.
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {outstanding.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">
                      {entry.case_number} · {entry.matter_title}
                    </p>
                    <p
                      className={cn(
                        "text-xs",
                        entry.state === "both" ? "text-warning" : "text-muted-foreground",
                      )}
                    >
                      {STATE_LABEL[entry.state]}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => onOpenMatter(entry.id)}>
                    Open file
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
