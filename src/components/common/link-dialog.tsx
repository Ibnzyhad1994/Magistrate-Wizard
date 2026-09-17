import { useEffect, useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isSafeHref } from "@/lib/html-sanitize";

interface LinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing href when editing a link already in the text. */
  initialHref?: string;
  /** Called with a validated (`isSafeHref`) URL. */
  onSubmit: (href: string) => void;
  /** Offered when `initialHref` is set, so a link can be cleared from the same place it was set. */
  onRemove?: () => void;
}

/**
 * Accessible replacement for `window.prompt("Link URL")` in the rich-text
 * editor: a labelled input, an inline validation message tied to the field
 * with `aria-describedby`/`aria-invalid`, and Radix focus trap/restore.
 * Only `http`, `https` and `mailto` hrefs pass, matching the sanitiser.
 */
export function LinkDialog({
  open,
  onOpenChange,
  initialHref = "",
  onSubmit,
  onRemove,
}: LinkDialogProps) {
  const [href, setHref] = useState(initialHref);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = `${inputId}-error`;

  useEffect(() => {
    if (open) {
      setHref(initialHref);
      setError(null);
    }
  }, [open, initialHref]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = href.trim();
    if (!trimmed) {
      setError("Enter a web address.");
      return;
    }
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    if (!isSafeHref(candidate)) {
      setError("Links must start with http://, https:// or mailto:.");
      return;
    }
    onSubmit(candidate);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{initialHref ? "Edit link" : "Insert link"}</DialogTitle>
            <DialogDescription>
              The selected text will open this address in a new tab.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-1.5">
            <Label htmlFor={inputId}>Web address</Label>
            <Input
              id={inputId}
              type="url"
              inputMode="url"
              autoComplete="url"
              value={href}
              onChange={(e) => {
                setHref(e.target.value);
                if (error) setError(null);
              }}
              placeholder="https://"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
            {error ? (
              <p id={errorId} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter className="mt-6">
            {initialHref && onRemove ? (
              <Button
                type="button"
                variant="ghost"
                className="sm:mr-auto"
                onClick={() => {
                  onRemove();
                  onOpenChange(false);
                }}
              >
                Remove link
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{initialHref ? "Update link" : "Insert link"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
