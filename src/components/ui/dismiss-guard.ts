import { toast } from "sonner";

export const UNSAVED_CHANGES_TOAST_ID = "unsaved-changes";

/**
 * Shared by `DialogContent` and `SheetContent`. When `prevent` is true the
 * implicit dismissals (click outside, Escape) are cancelled and a short
 * toast explains why — a silently ignored click reads as a broken dialog.
 * The explicit Close / Cancel controls are not intercepted: pressing them
 * is a decision, not an accident.
 */
export function guardDismiss(
  prevent: boolean | undefined,
  event: { preventDefault(): void; defaultPrevented: boolean },
): void {
  if (!prevent || event.defaultPrevented) return;
  event.preventDefault();
  toast.message("You have unsaved changes.", {
    id: UNSAVED_CHANGES_TOAST_ID,
    description: "Save or cancel to close.",
    duration: 3000,
  });
}
