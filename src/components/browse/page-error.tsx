import { Link } from "react-router-dom";
import { ArrowLeft, SearchX } from "lucide-react";
import { BrowsePage } from "@/components/browse/browse-page";
import { InlineError, type InlineErrorProps } from "@/components/common/inline-error";
import { Button } from "@/components/ui/button";

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

interface PageNotFoundProps {
  /** What is missing, said the way the page's own copy says it. */
  message: string;
  /** Where the page's own Back button would have gone. */
  back: { to: string; label: string };
}

/**
 * A detail page whose record does not exist or is out of reach. Not an
 * error: there is nothing to retry, so instead of Retry it offers the way
 * back to the list.
 */
export function PageNotFound({ message, back }: PageNotFoundProps) {
  return (
    <BrowsePage>
      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-hairline px-6 py-10 text-center hc:border-border">
        <SearchX className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-sm font-medium text-foreground">Not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
        <Button asChild size="sm" variant="outline" className="mt-2">
          <Link to={back.to}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {back.label}
          </Link>
        </Button>
      </div>
    </BrowsePage>
  );
}
