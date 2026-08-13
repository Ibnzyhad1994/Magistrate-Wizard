import type { ReactNode } from "react";
import { QueryProvider } from "@/providers/query-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { AuthProvider } from "@/providers/auth-provider";
import { ErrorBoundary } from "@/components/common/error-boundary";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

interface AppProvidersProps {
  children: ReactNode;
}

/**
 * Single composition root for every app-wide provider. Order matters:
 * ErrorBoundary wraps everything so provider-init errors are caught,
 * QueryProvider must be above AuthProvider (auth code can use queries),
 * and ThemeProvider is outermost visually so it can theme error states.
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <QueryProvider>
          <TooltipProvider delayDuration={200}>
            <AuthProvider>{children}</AuthProvider>
            <Toaster />
          </TooltipProvider>
        </QueryProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
