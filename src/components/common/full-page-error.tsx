import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FullPageErrorProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

/**
 * Shared full-viewport error state used by `ErrorBoundary` and
 * `RouteErrorBoundary`. Keep this presentational only — callers decide
 * what "retry" means (reload the page, reset boundary state, refetch).
 */
export function FullPageError({
  title = "Something went wrong",
  message = "An unexpected error occurred. You can try again, and if the problem persists, contact your system administrator.",
  onRetry,
  retryLabel = "Try again",
}: FullPageErrorProps) {
  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        <Button onClick={onRetry} variant="default">
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
