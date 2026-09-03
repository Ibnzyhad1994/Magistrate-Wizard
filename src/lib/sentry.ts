import * as Sentry from "@sentry/react";

/** No-op when `VITE_SENTRY_DSN` is unset so local/dev stays quiet. */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
  });
}

export function reportRenderError(
  error: Error,
  errorInfo: { componentStack?: string | null },
): void {
  if (!import.meta.env.VITE_SENTRY_DSN) return;
  Sentry.captureException(error, {
    extra: { componentStack: errorInfo.componentStack },
  });
}
