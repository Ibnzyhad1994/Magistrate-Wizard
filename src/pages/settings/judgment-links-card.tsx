import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { InlineError } from "@/components/common/inline-error";
import { useMyOrphanPinCount, useUnlinkMyOrphanPins } from "@/hooks/use-court-handover";

/**
 * A judgment's owner clears the pins they left, before 0220, on matters
 * they can no longer open (unlink_my_orphaned_judgment_pins). A dry run
 * counts them first; removing unlinks only those pins, never a judgment.
 * Hand-overs since 0220 unlink such pins on their own.
 */
export function JudgmentLinksCard() {
  const count = useMyOrphanPinCount();
  const unlink = useUnlinkMyOrphanPins();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pins = count.data ?? 0;
  const noun = pins === 1 ? "link" : "links";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Judgment links</CardTitle>
        <CardDescription>
          Links from your judgments to docket matters at courts you have left, which nobody else can
          see.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {count.isPending ? (
          <div role="status" className="space-y-2">
            <span className="sr-only">Counting your judgment links…</span>
            <Skeleton className="h-4 w-64" />
          </div>
        ) : count.isError ? (
          <InlineError error={count.error} onRetry={() => void count.refetch()} bare />
        ) : pins === 0 ? (
          <p className="text-muted-foreground">
            None. Every link from your judgments points to a matter you can still open.
          </p>
        ) : (
          <>
            <p className="text-foreground">
              {pins} {noun} from your judgments point to matters you can no longer open.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
              Remove {pins} {noun}
            </Button>
          </>
        )}
      </CardContent>
      <AlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Remove ${pins} judgment ${noun}?`}
        description="Only the links go. The judgments themselves, their content and their shares stay as they are."
        confirmLabel={`Remove ${noun}`}
        isConfirming={unlink.isPending}
        onConfirm={() => unlink.mutate(undefined, { onSuccess: () => setConfirmOpen(false) })}
      />
    </Card>
  );
}
