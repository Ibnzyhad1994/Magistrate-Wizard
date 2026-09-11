import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { playCue } from "@/lib/sound-cues";

/**
 * A quiet per-card indicator of whether edits have actually reached the
 * server.
 *
 * The app commits changes four different ways — explicit Save button,
 * debounced autosave, save-on-blur, and instant-commit — and several of
 * those sit on the same screen. On the Judgment detail page, "Save
 * details" and "Save content" are explicit while the discoverable
 * toggle, category, and tags all write the moment they change, with
 * nothing distinguishing them. On the surface whose purpose is producing
 * a formal legal document, "has this been written down yet?" should not
 * be something the magistrate has to remember per control.
 *
 * This does not unify those models — that is a deliberate product
 * decision, not a refactor to make in passing. It makes the current
 * behaviour visible, which is the prerequisite for changing it safely.
 *
 * Deliberately understated: no icon, no colour block, small type. It is
 * a status line, not an alert — the only state worth any visual weight is
 * "unsaved", and even that stays calm.
 */
export function SaveState({
  isDirty,
  isSaving,
  className,
}: {
  isDirty: boolean;
  isSaving?: boolean;
  className?: string;
}) {
  const [justSaved, setJustSaved] = useState(false);
  const wasDirty = useRef(isDirty);

  useEffect(() => {
    // Only flash "Saved" on a real dirty -> clean transition, never on
    // first mount of an already-clean card.
    if (wasDirty.current && !isDirty && !isSaving) {
      setJustSaved(true);
      // The success cue hangs off this transition rather than individual
      // save handlers: every explicit-save card in the app already routes
      // through this component, so one hook point covers them all and
      // can't drift out of sync with what the indicator claims.
      playCue("success");
      const timer = setTimeout(() => setJustSaved(false), 2500);
      wasDirty.current = isDirty;
      return () => clearTimeout(timer);
    }
    wasDirty.current = isDirty;
  }, [isDirty, isSaving]);

  const label = isSaving
    ? "Saving…"
    : isDirty
      ? "Unsaved changes"
      : justSaved
        ? "Saved"
        : null;

  if (!label) return null;

  return (
    <span
      // Announced politely so a screen-reader user learns the same thing
      // a sighted user does, without interrupting typing.
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium tabular-nums",
        isDirty && !isSaving ? "text-[hsl(var(--stage-progress))]" : "text-foreground/45",
        className,
      )}
    >
      {isDirty && !isSaving && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--stage-progress))]"
        />
      )}
      {label}
    </span>
  );
}
