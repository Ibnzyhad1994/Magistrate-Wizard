import { Link } from "react-router-dom";
import { DashboardHeading } from "@/components/dashboard/dashboard-folio";
import type { DashboardInsight, InsightSeverity } from "@/lib/dashboard-insights";
import { cn } from "@/lib/utils";

const MARK: Record<InsightSeverity, { label: string; className: string }> = {
  urgent: { label: "Now", className: "text-destructive" },
  attention: { label: "Soon", className: "text-notice-action" },
  nudge: { label: "Next", className: "text-muted-foreground" },
};

export function SuggestionList({
  insights,
  isPending = false,
}: {
  insights: DashboardInsight[];
  isPending?: boolean;
}) {
  return (
    <section aria-labelledby="suggestions-heading">
      <DashboardHeading
        id="suggestions-heading"
        hintLabel="How these suggestions are chosen"
        hint="These are fixed rules over files you can already see: overdue sittings, missing next dates, delivered rulings without a file, un-synced offline hearings. Nothing here is a model guess."
      >
        Next logs
      </DashboardHeading>
      {isPending ? (
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          Reading the files in view…
        </p>
      ) : insights.length === 0 ? (
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          No gaps on the files in view. Keep logging appearances and procedure as you sit.
        </p>
      ) : (
        <ol className="divide-y divide-hairline">
          {insights.map((insight, index) => {
            const mark = MARK[insight.severity];
            const ordinal = String(index + 1).padStart(2, "0");
            return (
              <li key={insight.id}>
                <Link
                  to={insight.href}
                  className="group grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[3rem_3.25rem_minmax(0,1fr)] sm:gap-4"
                >
                  <span className="text-lg font-semibold tabular-nums tracking-tight text-muted-foreground group-hover:text-foreground">
                    {ordinal}
                  </span>
                  <span className={cn("eyebrow hidden sm:block", mark.className)}>
                    {mark.label}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-2 sm:hidden">
                      <span className={cn("eyebrow", mark.className)}>{mark.label}</span>
                    </span>
                    <span className="block text-base font-medium leading-snug text-foreground group-hover:text-primary">
                      {insight.title}
                    </span>
                    <span className="mt-1.5 block text-sm leading-relaxed text-muted-foreground">
                      {insight.why}
                    </span>
                    <span className="eyebrow mt-2 inline-block text-link">{insight.cta} →</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
