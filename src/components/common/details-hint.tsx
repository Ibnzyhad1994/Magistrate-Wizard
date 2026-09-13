import { CircleHelp } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Extra copy behind a tap target. Hover tooltips fail on a phone; this
 * opens on click and stays until the magistrate taps away.
 */
export function DetailsHint({
  label,
  details,
}: {
  label: string;
  details: string;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={label}
        >
          <CircleHelp className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={12}
        className="z-[80] max-w-[min(18rem,calc(100vw-1.5rem))] border-border bg-card p-3 text-xs leading-relaxed text-foreground shadow-md"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {details}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
