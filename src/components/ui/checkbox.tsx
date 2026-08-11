import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Plain native-checkbox implementation (no @radix-ui/react-checkbox — not
 * installed in this sandbox and npm-registry access is blocked here). Same
 * visual language as the rest of the kit; swap for the Radix primitive
 * later if it becomes available without changing call sites.
 */
export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "type"> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, ...props }, ref) => {
    return (
      <span className="relative inline-flex h-4 w-4 shrink-0">
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          className={cn(
            "peer h-4 w-4 shrink-0 appearance-none rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 checked:bg-primary",
            className,
          )}
          {...props}
        />
        <Check className="pointer-events-none absolute left-0 top-0 h-4 w-4 p-[2px] text-primary-foreground opacity-0 peer-checked:opacity-100" />
      </span>
    );
  },
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
