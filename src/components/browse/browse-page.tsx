import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BrowsePageProps {
  children: ReactNode;
  className?: string;
  /** Skip the top offset when a billboard already clears the nav. */
  flushTop?: boolean;
}

/**
 * Standard padded browse canvas under the fixed top nav. The bottom inset is
 * the body's (index.css), so it is not added again here.
 */
export function BrowsePage({ children, className, flushTop }: BrowsePageProps) {
  return (
    <div
      className={cn(
        "browse-gutter pb-20",
        flushTop ? "pt-0" : "pt-[calc(6rem+env(safe-area-inset-top)+var(--offline-banner-h))]",
        className,
      )}
    >
      {children}
    </div>
  );
}
