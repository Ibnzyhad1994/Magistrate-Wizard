import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { DetailsHint } from "@/components/common/details-hint";
import { cn } from "@/lib/utils";

export function MetricStat({
  label,
  value,
  hint,
  href,
  selected = false,
  tone = "ink",
}: {
  label: string;
  value: string | number;
  hint: string;
  href?: string;
  selected?: boolean;
  tone?: "ink" | "warn" | "ok";
}) {
  const numberClass = cn(
    "text-4xl font-extrabold tabular-nums leading-none tracking-tight",
    tone === "warn" && "text-destructive",
    tone === "ok" && "text-foreground",
    tone === "ink" && "text-foreground",
  );

  const body = (
    <>
      <p className="eyebrow text-muted-foreground">{label}</p>
      <span className={numberClass}>{value}</span>
    </>
  );

  return (
    <div
      className={cn(
        "flex min-w-[9.5rem] flex-1 flex-col justify-end gap-3 rounded-md border border-hairline bg-card px-4 py-5 shadow-elevation-1 transition-colors hc:border-border sm:px-5",
        selected && "border-primary/60 bg-surface-2",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {href ? (
          <Link
            to={href}
            aria-current={selected ? "page" : undefined}
            aria-label={`${label}: ${value}`}
            className="flex min-w-0 flex-1 flex-col gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {body}
          </Link>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-3">{body}</div>
        )}
        <DetailsHint label={`How ${label} is counted`} details={hint} />
      </div>
    </div>
  );
}

export function MetricLedger({ children }: { children: ReactNode }) {
  return (
    <div data-tour="dashboard-metrics" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {children}
    </div>
  );
}
