import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AppLogo } from "@/components/brand/app-logo";
import { AppCanvas } from "@/components/theme/app-canvas";

interface FullPageErrorProps {
  title?: string;
  message?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /** Replaces the retry button, e.g. a link back home. */
  action?: ReactNode;
  /**
   * Makes the wordmark a link. Only inside the router: `ErrorBoundary`
   * renders this outside it, so it leaves the wordmark plain.
   */
  logoHref?: string;
}

/**
 * Shared full-viewport error state used by `ErrorBoundary`,
 * `RouteErrorBoundary`, and the not-found and unauthorised pages. Keep this
 * presentational only — callers decide what "retry" means (reload the
 * page, reset boundary state, refetch).
 */
export function FullPageError({
  title = "Something went wrong",
  message = "Something went wrong. Try again, and if it keeps happening, contact your administrator.",
  onRetry,
  retryLabel = "Try again",
  action,
  logoHref,
}: FullPageErrorProps) {
  return (
    <AppCanvas>
      <header className="relative z-10 px-6 py-5 sm:px-12 sm:py-6">
        {logoHref ? (
          <Link
            to={logoHref}
            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <AppLogo size="lg" />
          </Link>
        ) : (
          <AppLogo size="lg" />
        )}
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-16 text-center">
        <div className="space-y-3">
          <h1 className="text-display text-foreground">{title}</h1>
          <p className="max-w-md text-base text-muted-foreground">{message}</p>
        </div>
        {action ??
          (onRetry && (
            <Button
              onClick={onRetry}
              variant="default"
              className="h-12 px-8 text-base font-semibold"
            >
              {retryLabel}
            </Button>
          ))}
      </main>
    </AppCanvas>
  );
}
