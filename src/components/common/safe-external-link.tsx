import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { isSafeHref } from "@/lib/html-sanitize";

interface SafeExternalLinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "target" | "rel"
> {
  href: string | null | undefined;
  children: ReactNode;
  /** Rendered instead of the anchor when `href` fails `isSafeHref` (defaults to the children as plain text). */
  fallback?: ReactNode;
}

/**
 * Anchor for URLs that come from the database (`source_url` and friends).
 * Renders a real `<a target="_blank" rel="noopener noreferrer">` only when
 * the href passes `isSafeHref` (http(s)/mailto); otherwise the children are
 * shown as plain text so a stored `javascript:` or `data:` URL is inert.
 * Forwards its ref so it works as a Radix `asChild` target.
 */
export const SafeExternalLink = forwardRef<HTMLAnchorElement, SafeExternalLinkProps>(
  function SafeExternalLink({ href, children, fallback, ...rest }, ref) {
    if (!href || !isSafeHref(href)) {
      return <span className={rest.className}>{fallback ?? children}</span>;
    }
    return (
      <a {...rest} ref={ref} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
);
