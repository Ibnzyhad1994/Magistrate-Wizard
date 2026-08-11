import { AlertCircle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type SaveState = "idle" | "saving" | "saved" | "error";

interface SaveIndicatorProps {
  state: SaveState;
  onRetry?: () => void;
  className?: string;
}

/**
 * Small, unobtrusive autosave-status readout — reflects actual
 * persistence state (a mutation's own pending/success/error), never
 * merely local "the user typed something" dirty-tracking. Shared so any
 * future autosaving editor (Judgment, Quick Codes, etc.) can reuse the
 * same states/copy instead of re-inventing "Saving…"/"Saved" text.
 */
export function SaveIndicator({ state, onRetry, className }: SaveIndicatorProps) {
  if (state === "idle") return null;

  if (state === "saving") {
    return (
      <span className={`flex items-center gap-1.5 text-xs text-muted-foreground ${className ?? ""}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Saving…
      </span>
    );
  }

  if (state === "saved") {
    return (
      <span className={`flex items-center gap-1.5 text-xs text-muted-foreground ${className ?? ""}`}>
        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-500" />
        Saved
      </span>
    );
  }

  return (
    <span className={`flex items-center gap-1.5 text-xs text-destructive ${className ?? ""}`}>
      <AlertCircle className="h-3.5 w-3.5" />
      Save failed
      {onRetry && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs text-destructive underline"
          onClick={onRetry}
        >
          Retry
        </Button>
      )}
    </span>
  );
}
