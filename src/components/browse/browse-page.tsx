import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BrowsePageProps {
  children: ReactNode;
  className?: string;
  /** Skip the top offset when a billboard already clears the nav. */
  flushTop?: boolean;
}

/** Standard padded browse canvas under the fixed top nav. */
export function BrowsePage({ children, className, flushTop }: BrowsePageProps) {
  return (
    <div
      className={cn(
        "browse-gutter pb-[calc(5rem+env(safe-area-inset-bottom))]",
        flushTop ? "pt-0" : "pt-[calc(6rem+env(safe-area-inset-top))]",
        className,
      )}
    >
      {children}
    </div>
  );
}
