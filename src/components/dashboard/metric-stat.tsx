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
    "font-brand text-4xl font-semibold tabular-nums leading-none tracking-tight",
    tone === "warn" && "text-destructive",
    tone === "ok" && "text-foreground",
    tone === "ink" && "text-foreground",
  );

  const body = (
    <>
      <p className="font-brand text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      <span className={numberClass}>{value}</span>
    </>
  );

  return (
    <div
      className={cn(
        "flex min-w-[9.5rem] flex-1 flex-col justify-end gap-3 px-4 py-5 sm:px-5",
        selected && "bg-foreground/[0.06]",
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
    <div
      data-tour="dashboard-metrics"
      className="overflow-hidden border-y-2 border-foreground/30 bg-background/70"
    >
      <div className="grid grid-cols-2 xl:grid-cols-4 max-xl:[&>*:nth-child(2n)]:border-r-0 xl:[&>*:nth-child(4n)]:border-r-0 [&>*]:border-b [&>*]:border-r [&>*]:border-border">
        {children}
      </div>
    </div>
  );
}
