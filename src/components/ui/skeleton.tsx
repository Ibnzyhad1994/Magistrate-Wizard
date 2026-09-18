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
      className={cn(
        // A sheen sweeping across a muted block. Reduced motion collapses
        // the animation globally (index.css), leaving a still block.
        "animate-shimmer rounded-md bg-muted bg-[linear-gradient(100deg,hsl(var(--muted))_30%,hsl(var(--surface-3))_50%,hsl(var(--muted))_70%)] bg-[length:200%_100%]",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
