import { useEffect } from "react";
import { useBlocker } from "react-router-dom";

/**
 * Warns before unsaved work is discarded, on BOTH exit routes.
 *
 * `beforeunload` alone — which is what the Judgment and Legislation
 * editors had — only covers leaving the browser: refresh, tab close,
 * back to another site. It does not fire for in-app navigation, so
 * clicking any nav item mid-edit discarded the draft silently. That is
 * the most common way a person leaves a page, and this application has
 * already lost a real, already-typed judgment to this exact bug class
 * (see the note above ContentCard in judgment-detail-page.tsx — it was
 * confirmed through audit_log at the time).
 *
 * `useBlocker` closes the remaining route. It is deliberately paired with
 * the native prompt rather than replacing it: the two cover different
 * exits and neither is sufficient alone.
 *
 * The confirm() here is intentional. A custom dialog cannot be used for
 * the `beforeunload` half (browsers own that prompt), so a custom dialog
 * for the in-app half would mean two different-looking warnings for the
 * same situation. One consistent prompt is the better trade.
 */
export function useUnsavedChangesGuard(
  isDirty: boolean,
  message = "You have unsaved changes. Leave this page and discard them?",
) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(message)) blocker.proceed();
    else blocker.reset();
  }, [blocker, message]);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);
}
