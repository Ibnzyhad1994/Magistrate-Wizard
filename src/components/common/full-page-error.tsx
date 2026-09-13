import { Button } from "@/components/ui/button";
import { AppLogo } from "@/components/brand/app-logo";
import { AppCanvas } from "@/components/theme/app-canvas";

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
    <AppCanvas>
      <header className="relative z-10 px-6 py-5 sm:px-12 sm:py-6">
        <AppLogo size="lg" />
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-16 text-center">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            {title}
          </h1>
          <p className="max-w-md text-base text-foreground/70">{message}</p>
        </div>
        {onRetry && (
          <Button
            onClick={onRetry}
            variant="default"
            className="h-12 px-8 text-base font-semibold"
          >
            {retryLabel}
          </Button>
        )}
      </main>
    </AppCanvas>
  );
}
