import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getErrorMessage, isRateLimitedError } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface InlineErrorProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

/**
 * In-content (not full-page) error state for a failed query inside a
 * card, tab panel, or list — pairs with `EmptyState` and the global
 * `RouteErrorBoundary`, which stays reserved for render-time crashes.
 */
export function InlineError({ error, onRetry, className }: InlineErrorProps) {
  const message = getErrorMessage(error);
  // Retry is deliberately withheld here: the limiter refuses on a window, so
  // an immediate retry only re-trips it.
  const rateLimited = isRateLimitedError(error);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center",
        className,
      )}
    >
      <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">
        {rateLimited ? "Too many requests" : "Couldn't load this data"}
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {rateLimited ? "Try again in a minute." : message}
      </p>
      {onRetry && !rateLimited && (
        <Button size="sm" variant="outline" onClick={onRetry} className="mt-2">
          <RotateCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      )}
    </div>
  );
}
