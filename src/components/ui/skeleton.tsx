import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Purely decorative placeholder. Hidden from assistive tech: the region
 * that contains it should carry `aria-busy` / `role="status"` with real
 * text instead (see docs/ui-conventions.md).
 */
function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
