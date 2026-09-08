import { useEffect, useState } from "react";

/**
 * Default settle delay, carried over verbatim from the inline timer this
 * hook replaces on the Search page — long enough that an ordinary typing
 * cadence produces one query instead of one per keystroke, short enough
 * that a deliberate pause still feels immediate.
 */
export const DEFAULT_DEBOUNCE_MS = 350;

/**
 * Returns `value` only once it has stopped changing for `delayMs`.
 *
 * Every list surface in this app puts its search text directly into a
 * React Query key (see `docketMattersKeys.board`), so an un-debounced
 * input means one RPC per keystroke — and, because a brand-new query key
 * has no cached data, `isPending` flips true and the whole list is
 * replaced by a skeleton each time. Debouncing the value that reaches the
 * query (never the input itself, which stays fully controlled and
 * instantly responsive) collapses that to a single request once typing
 * settles.
 *
 * Deliberately returns the FIRST value immediately rather than after a
 * delay: a page opened with an existing query — a bookmarked filtered
 * Docket view, or `/search?q=…` — must fetch straight away, not sit blank
 * for 350ms.
 */
export function useDebouncedValue<T>(value: T, delayMs: number = DEFAULT_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (Object.is(value, debounced)) return;
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
    // `debounced` is deliberately not a dependency: including it would
    // re-arm the timer on settle and re-run this effect for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delayMs]);

  return debounced;
}
