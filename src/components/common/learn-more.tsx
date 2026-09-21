import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A short "Learn more" link that opens a longer explanation in place.
 *
 * Use it when the detail is a paragraph or a short list. For a sentence or
 * two, `DetailsHint` (the "?" popover) is lighter. Keep the visible copy
 * short and put the reasoning here, so the page reads quickly and the
 * detail is still one tap away.
 */
export function LearnMore({
  children,
  label = "Learn more",
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? "Show less" : label}
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          id={panelId}
          className="mt-2 max-w-2xl space-y-2 text-sm leading-relaxed text-muted-foreground"
        >
          {children}
        </div>
      )}
    </div>
  );
}
