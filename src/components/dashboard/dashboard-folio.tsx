import type { ReactNode } from "react";
import { DetailsHint } from "@/components/common/details-hint";
import { cn } from "@/lib/utils";

/**
 * Briefing frame. Once a folio pastiche (ruled paper, crimson margin,
 * serif kickers); now the same surfaces and type as the rest of the
 * product so the operational page and the cinematic Home read as one
 * app. The ledger structure and numbered logs are what carry the
 * "briefing" feel, not the chrome.
 */
export function DashboardFolio({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("relative", className)}>{children}</div>;
}

export function DashboardKicker({ children }: { children: ReactNode }) {
  return <p className="eyebrow text-muted-foreground">{children}</p>;
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
    <div className="mb-5 flex items-center gap-1.5 border-b border-hairline pb-2 hc:border-border">
      <h2 id={id} className="text-title text-foreground">
        {children}
      </h2>
      <DetailsHint label={hintLabel} details={hint} />
    </div>
  );
}
