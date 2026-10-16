import { Gavel } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Marks a matter that is on a callover that day. Outlined, with the
 * Callovers gavel, so it reads apart from the filled classification and
 * court chips beside it without looking like a status.
 */
export function CalloverChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "mt-0.5 inline-flex items-center gap-1 rounded-[2px] border border-input px-1.5 py-0.5 text-[10px] font-medium text-foreground",
        className,
      )}
    >
      <Gavel className="h-2.5 w-2.5" aria-hidden="true" />
      Callover
    </span>
  );
}
