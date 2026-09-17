import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/** How long to wait after a route change for the new page to write its `document.title`. Pages set the title in an effect; lazy routes mount a beat later. */
const TITLE_SETTLE_MS = 250;

/**
 * Announces route changes to assistive technology and resets keyboard focus
 * to the page (WCAG 2.4.3 / 4.1.3). A single-page app never reloads, so
 * without this a screen-reader user hears nothing when a link is followed
 * and the keyboard focus stays on the link they just left.
 *
 * - `aria-live="polite"` region reads the new `document.title` once it has
 *   settled after each pathname change.
 * - Focus moves to `#main-content` (rendered `tabIndex={-1}` by both
 *   layouts) on every pathname change except the initial mount, so the
 *   next Tab lands on the first control of the new page.
 */
export function RouteAnnouncer() {
  const { pathname } = useLocation();
  const [message, setMessage] = useState("");
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const main = document.getElementById("main-content");
    if (main instanceof HTMLElement) {
      // A modal (Radix dialog, tour overlay) that is open across the
      // navigation keeps focus for itself; only reset when nothing is trapping.
      const trapped = document.querySelector('[role="dialog"][aria-modal="true"]');
      if (!trapped) main.focus({ preventScroll: true });
    }
    // Clear first so an identical title (e.g. two matter pages) still
    // registers as a change in the live region.
    setMessage("");
    const timer = window.setTimeout(() => {
      const title = document.title.split(" · ")[0]?.trim();
      setMessage(title ? `Navigated to ${title}` : "Page changed");
    }, TITLE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
