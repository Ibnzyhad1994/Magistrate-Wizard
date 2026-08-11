import { useLocation } from "react-router-dom";

interface BackNavState {
  backTo?: string;
  backLabel?: string;
}

/**
 * Lets a detail page's "Back" button return to wherever the user actually
 * came from (e.g. Bookmarks) instead of always defaulting to that
 * entity's own list page — without building a general browser-history
 * stack. The calling page just passes `state: { backTo, backLabel }` on
 * `navigate(...)`; if absent (direct link, refresh, or navigation from
 * somewhere that hasn't opted in yet), the caller's own default is used.
 */
export function useBackNav(defaultTo: string, defaultLabel: string) {
  const location = useLocation();
  const state = (location.state ?? null) as BackNavState | null;
  return {
    to: state?.backTo ?? defaultTo,
    label: state?.backLabel ?? defaultLabel,
  };
}
