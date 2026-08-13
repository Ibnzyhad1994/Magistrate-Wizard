import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/constants";

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
    <div className="relative flex min-h-dvh w-full flex-col bg-black">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden bg-[#141414]"
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_#2a2a2a_0%,_#141414_50%,_#000_100%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-black" />
      </div>

      <header className="relative z-10 px-6 py-5 sm:px-12 sm:py-6">
        <span className="text-2xl font-extrabold tracking-tight text-primary sm:text-[1.75rem]">
          {APP_NAME}
        </span>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-16 text-center">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            {title}
          </h1>
          <p className="max-w-md text-base text-white/70">{message}</p>
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
    </div>
  );
}
