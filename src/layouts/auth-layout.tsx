import { Outlet } from "react-router-dom";
import { Scale } from "lucide-react";

/**
 * Centered shell for public/unauthenticated routes (login, register,
 * forgot password). Deliberately minimal — no sidebar, no auth-gated
 * chrome.
 */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <div className="mb-8 flex items-center gap-2 text-foreground">
        <Scale className="h-7 w-7" aria-hidden="true" />
        <span className="text-xl font-semibold tracking-tight">
          BenchBook
        </span>
      </div>
      <div className="w-full max-w-sm">
        <Outlet />
      </div>
    </div>
  );
}
