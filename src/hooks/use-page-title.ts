import { useEffect } from "react";

export const APP_TITLE = "Magistrate Wizard";

/** Formats a page title the way `usePageTitle` writes it to `document.title`. */
export function formatPageTitle(title: string) {
  return `${title} · ${APP_TITLE}`;
}

/**
 * Sets `document.title` to "<title> · Magistrate Wizard" for the life of the
 * calling component and restores the previous title on unmount (WCAG 2.4.2).
 * `BrowseHeader` calls it for every list page; detail pages and the auth /
 * dashboard pages call it directly. A falsy title (e.g. a record still
 * loading) leaves the document title alone until the real one is known.
 */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title || typeof document === "undefined") return;
    const previous = document.title;
    document.title = formatPageTitle(title);
    return () => {
      document.title = previous;
    };
  }, [title]);
}
