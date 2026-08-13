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
        "browse-gutter pb-20",
        flushTop ? "pt-0" : "pt-24",
        className,
      )}
    >
      {children}
    </div>
  );
}
