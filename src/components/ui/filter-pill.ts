import { cn } from "@/lib/utils";

/**
 * A filter pill (a toggle in a row of filters, with `aria-pressed`): one
 * recipe everywhere. Selected inverts to ink, never the accent, because red
 * is the commit action; unselected is a control edge with muted words.
 */
export const filterPillClass = (selected: boolean) =>
  cn(
    "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    selected
      ? "border-foreground bg-foreground text-background"
      : "border-input text-muted-foreground hover:bg-surface-2 hover:text-foreground",
  );
