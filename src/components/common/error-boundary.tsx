import { Component, type ErrorInfo, type ReactNode } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { FullPageError } from "@/components/common/full-page-error";
import { getErrorMessage } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level render-error boundary (class component — React requires this;
 * there is no hooks-based equivalent for `componentDidCatch`). Wraps the
 * entire provider tree in `AppProviders` so a crash anywhere below still
 * renders a recoverable full-page error instead of a blank screen.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Replace with a real error-reporting integration (e.g. Sentry) when
    // one is wired up. Left as console output intentionally so failures
    // are never silently swallowed during development.
    console.error(`${APP_NAME} render error:`, error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <FullPageError
          title={`${APP_NAME} hit an unexpected error`}
          message={
            this.state.error
              ? getErrorMessage(this.state.error)
              : undefined
          }
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

/**
 * Route-level error boundary for use as a router `errorElement`. Handles
 * both thrown Response objects (404s, loader failures) and thrown errors.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <FullPageError
        title={`${error.status} ${error.statusText}`}
        message={
          typeof error.data === "string"
            ? error.data
            : "This page could not be loaded."
        }
        onRetry={() => window.location.assign("/")}
        retryLabel="Go home"
      />
    );
  }

  return (
    <FullPageError
      message={getErrorMessage(error)}
      onRetry={() => window.location.reload()}
      retryLabel="Reload"
    />
  );
}
