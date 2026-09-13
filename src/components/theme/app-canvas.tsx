import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AppCanvasProps {
  children: ReactNode;
  className?: string;
}

/**
 * Full-viewport canvas used by public shells (sign-in, errors, 404).
 * Tokens only — dark stays the original theater, light uses the paper palette.
 */
export function AppCanvas({ children, className }: AppCanvasProps) {
  return (
    <div className={cn("relative flex min-h-dvh w-full flex-col bg-background", className)}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_hsl(var(--muted))_0%,_hsl(var(--background))_50%,_hsl(var(--background))_100%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-background/80" />
      </div>
      {children}
    </div>
  );
}

/** Sign-in / register card surface. */
export const AUTH_PANEL_CLASS = "border-0 bg-card/90 shadow-none";
