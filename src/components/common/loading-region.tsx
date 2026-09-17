import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface LoadingRegionProps {
  /** What is loading, read by assistive technology: "Loading docket". Defaults to "Loading". */
  label?: string;
  className?: string;
  /** Visual placeholder (skeletons, a spinner). Skeletons are `aria-hidden`, so the only text announced is `label`. */
  children?: ReactNode;
}

/**
 * Wraps a loading placeholder so its state is announced (WCAG 4.1.3).
 * `role="status"` is an implicit polite live region, so the label is read
 * once when the region appears and nothing is repeated while it stays.
 */
export function LoadingRegion({ label = "Loading", className, children }: LoadingRegionProps) {
  return (
    <div role="status" aria-busy="true" className={cn(className)}>
      {children}
      <span className="sr-only">{label}…</span>
    </div>
  );
}
