import type { ReactNode } from "react";
import { DetailsHint } from "@/components/common/details-hint";
import { cn } from "@/lib/utils";

/**
 * Morning cause-list chrome: blotting-paper rules, a crimson margin
 * like a legal pad, brass kickers. Home stays cinematic; this page
 * should read as a folio laid on the bench.
 */
export function DashboardFolio({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(to_bottom,transparent,transparent_31px,hsl(var(--foreground)/0.055)_32px)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-primary sm:w-1.5"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-3 hidden w-px bg-primary/35 sm:block"
      />
      <div className="relative pl-6 sm:pl-10">{children}</div>
    </div>
  );
}

export function DashboardKicker({ children }: { children: ReactNode }) {
  return (
    <p className="font-brand text-[11px] font-semibold uppercase tracking-[0.32em] text-[hsl(var(--brass))]">
      {children}
    </p>
  );
}

export function DashboardHeading({
  id,
  hintLabel,
  hint,
  children,
}: {
  id: string;
  hintLabel: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-center gap-1.5 border-b border-foreground/20 pb-2">
      <h2 id={id} className="font-brand text-xl tracking-[0.14em] text-foreground">
        {children}
      </h2>
      <DetailsHint label={hintLabel} details={hint} />
    </div>
  );
}
