import * as React from "react";
import type { VariantProps } from "class-variance-authority";
import { alertVariants } from "@/components/ui/alert-variants";
import { cn } from "@/lib/utils";

/**
 * Inline notice. Colour comes from the semantic tokens (`warning` is the
 * palette's amber, `success` its green, `info` its blue, `destructive` its
 * red) so a warning in the colourblind-safe or high-contrast palette is
 * retuned with everything else — never a hardcoded amber-*.
 *
 * `warning` and `destructive` announce as `role="alert"`; the rest are
 * `role="status"`. Override `role` for a purely decorative panel.
 */

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, role, ...props }, ref) => (
  <div
    ref={ref}
    role={role ?? (variant === "warning" || variant === "destructive" ? "alert" : "status")}
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn("mb-1 font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  ),
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
