import { BrowsePage } from "@/components/browse/browse-page";
import { InlineError, type InlineErrorProps } from "@/components/common/inline-error";

/**
 * A detail page that could not load its record. The page has no header to
 * clear the fixed nav, so the error sits on the browse canvas instead of
 * under the nav.
 */
export function PageError(props: InlineErrorProps) {
  return (
    <BrowsePage>
      <InlineError {...props} />
    </BrowsePage>
  );
}
