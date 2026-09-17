import * as React from "react";
import { cn } from "@/lib/utils";

export interface ProgressProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** 0–100. Omit for an indeterminate bar. */
  value?: number | null;
  /** Upper bound when `value` is not already a percentage. Defaults to 100. */
  max?: number;
  /** Accessible name; required unless `aria-labelledby` is supplied. */
  label?: string;
  /** Read out in place of "NN%", e.g. "12 of 40 files". */
  valueText?: string;
  /** `success` and `warning` recolour the bar for a finished / stalled batch. */
  tone?: "default" | "success" | "warning" | "destructive";
}

const TONE_CLASS: Record<NonNullable<ProgressProps["tone"]>, string> = {
  default: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

/**
 * Determinate/indeterminate progress bar. Native semantics
 * (`role="progressbar"` + aria-value*) so a batch import is announced
 * rather than described in prose.
 */
const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, max = 100, label, valueText, tone = "default", ...props }, ref) => {
    const determinate = typeof value === "number" && Number.isFinite(value);
    const percent = determinate ? Math.min(100, Math.max(0, (value / max) * 100)) : undefined;

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={determinate ? value : undefined}
        aria-valuetext={determinate ? (valueText ?? `${Math.round(percent ?? 0)}%`) : valueText}
        className={cn("relative h-2 w-full overflow-hidden rounded-sm bg-muted", className)}
        {...props}
      >
        <div
          className={cn(
            "h-full rounded-sm transition-[width] duration-300 ease-out",
            TONE_CLASS[tone],
            !determinate && "w-1/3 animate-pulse",
          )}
          style={determinate ? { width: `${percent}%` } : undefined}
        />
      </div>
    );
  },
);
Progress.displayName = "Progress";

export { Progress };
