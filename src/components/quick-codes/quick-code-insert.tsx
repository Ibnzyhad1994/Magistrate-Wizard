import { useMemo, useState } from "react";
import { Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HintTooltip } from "@/components/ui/tooltip";
import { useQuickCodes } from "@/hooks/quick-codes/use-quick-codes";

/**
 * Drops one of the magistrate's own Quick Codes into an editor at the
 * cursor. Quick Codes were previously copy-to-clipboard only, so reusing
 * a stock paragraph meant leaving the judgment, finding the code, copying
 * it and coming back.
 *
 * Insertion is plain text on purpose: `quick_codes.content` is a text
 * column with no rich-text model behind it, so treating it as markup
 * would be inventing structure the record does not have.
 */
export function QuickCodeInsert({ onInsert }: { onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  // Only fetched once the control is first opened: every judgment and
  // bench-note editor mounts this, and most sessions never use it.
  const [everOpened, setEverOpened] = useState(false);
  const { data: codes, isPending } = useQuickCodes({ enabled: everOpened });

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const all = codes ?? [];
    if (!q) return all;
    return all.filter((code) =>
      [code.code_word, code.title, code.category, code.description]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q)),
    );
  }, [codes, filter]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setEverOpened(true);
        else setFilter("");
      }}
    >
      <HintTooltip label="Insert one of your Quick Codes">
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Insert a Quick Code"
          >
            <Braces className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent
        align="start"
        className="z-popover max-h-80 w-80 overflow-y-auto border-hairline bg-surface-1 shadow-elevation-3 hc:border-border"
      >
        <div className="p-1.5">
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter your Quick Codes…"
            aria-label="Filter Quick Codes"
            // The menu moves focus to its first item on open; without this
            // a keystroke meant for the filter would select an item.
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>
        {isPending ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">Loading your Quick Codes…</p>
        ) : matches.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">
            {(codes ?? []).length === 0
              ? "You have no Quick Codes yet."
              : "No Quick Code matches that."}
          </p>
        ) : (
          matches.map((code) => (
            <DropdownMenuItem
              key={code.id}
              className="cursor-pointer flex-col items-start gap-0.5"
              onSelect={() => {
                onInsert(code.content);
                setOpen(false);
              }}
            >
              <span className="font-medium text-foreground">
                {code.code_word}
                {code.title ? ` · ${code.title}` : ""}
              </span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{code.content}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
