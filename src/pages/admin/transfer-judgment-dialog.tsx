import { useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/common/inline-error";
import { useCourtBench, useTransferJudgmentOwnership } from "@/hooks/use-court-handover";
import {
  TRANSFER_REASON_MAX,
  shortId,
  transferErrorMessage,
  transferReasonProblem,
  type JudgmentTransfer,
} from "@/lib/court-handover";
import { z } from "@/lib/zod";
import { formatDateTime } from "@/lib/utils";

const judgmentIdSchema = z.guid();

export interface TransferJudgmentTarget {
  courtId: string;
  courtName: string | null;
  /** From a pre-flight pin; the administrator can also paste one. */
  judgmentId: string;
  /** The departing magistrate: never offered as the new owner. */
  fromProfileId: string;
}

interface TransferJudgmentDialogProps {
  target: TransferJudgmentTarget | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Administrator: move one judgment to a magistrate sitting at the court now
 * (transfer_judgment_ownership, ADR 0011). The administrator has no
 * judgment list (ADR 0007), so the id comes from the hand-over pre-flight.
 * Only ownership moves; the result is ids only. Key it on the target, so
 * each judgment opens a fresh form.
 */
export function TransferJudgmentDialog({ target, onOpenChange }: TransferJudgmentDialogProps) {
  const transfer = useTransferJudgmentOwnership();
  const bench = useCourtBench(target?.courtId ?? null);
  const [judgmentId, setJudgmentId] = useState(target?.judgmentId ?? "");
  const [toProfileId, setToProfileId] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<JudgmentTransfer | null>(null);
  const judgmentFieldId = useId();
  const targetFieldId = useId();
  const reasonFieldId = useId();
  const reasonHintId = useId();

  const candidates = (bench.data ?? []).filter((m) => m.profileId !== target?.fromProfileId);
  const judgmentIdValid = judgmentIdSchema.safeParse(judgmentId.trim()).success;
  const reasonProblem = transferReasonProblem(reason);
  const canSubmit = judgmentIdValid && !!toProfileId && reasonProblem === null && !result;
  const newOwnerName =
    candidates.find((m) => m.profileId === result?.to_owner_id)?.fullName ?? "the new owner";
  const refusal = transfer.isError ? transferErrorMessage(transfer.error) : null;

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        preventDismissWhenDirty={!result && (reason.trim().length > 0 || !!toProfileId)}
      >
        <DialogHeader>
          <DialogTitle>Transfer a judgment</DialogTitle>
          <DialogDescription>
            Only the owner changes. The content, its status and versions, shares and links stay as
            they are, and the original author is recorded.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <Alert variant="success" role="status">
            <AlertTitle>Judgment transferred to {newOwnerName}</AlertTitle>
            <AlertDescription className="space-y-1 text-foreground">
              <p>
                Judgment <span className="identifier">{shortId(result.judgment_id)}</span> ·
                transfer <span className="identifier">{shortId(result.transfer_id)}</span> ·{" "}
                {formatDateTime(result.transferred_at)}
              </p>
              <p className="text-muted-foreground">
                Both magistrates have been notified. The original author stays on record.
              </p>
            </AlertDescription>
          </Alert>
        ) : (
          <form
            id="transfer-judgment-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!target || !canSubmit) return;
              transfer.mutate(
                {
                  judgmentId: judgmentId.trim(),
                  toProfileId,
                  courtId: target.courtId,
                  reason,
                },
                { onSuccess: (transferred) => setResult(transferred) },
              );
            }}
          >
            <p className="text-sm text-muted-foreground">
              Court: <span className="text-foreground">{target?.courtName ?? "Unknown court"}</span>
            </p>

            <div className="space-y-1.5">
              <Label htmlFor={judgmentFieldId}>Judgment id</Label>
              <Input
                id={judgmentFieldId}
                className="identifier"
                value={judgmentId}
                onChange={(e) => setJudgmentId(e.target.value)}
                aria-invalid={judgmentId.trim() !== "" && !judgmentIdValid}
                spellCheck={false}
                autoComplete="off"
              />
              {judgmentId.trim() !== "" && !judgmentIdValid && (
                <p className="text-xs text-destructive-text">
                  Paste a judgment id from the hand-over.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={targetFieldId}>New owner</Label>
              {bench.isPending ? (
                <Skeleton className="h-11 w-full lg:h-9" />
              ) : bench.isError ? (
                <InlineError error={bench.error} onRetry={() => void bench.refetch()} bare />
              ) : candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nobody else sits at this court now. Assign its next magistrate first.
                </p>
              ) : (
                <Select
                  id={targetFieldId}
                  value={toProfileId}
                  onChange={(e) => setToProfileId(e.target.value)}
                >
                  <option value="">Choose a magistrate at this court…</option>
                  {candidates.map((m) => (
                    <option key={m.profileId} value={m.profileId}>
                      {m.fullName}
                    </option>
                  ))}
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={reasonFieldId}>Reason</Label>
              <Textarea
                id={reasonFieldId}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-describedby={reasonHintId}
                aria-invalid={reasonProblem === "too-long"}
                placeholder="e.g. The magistrate who wrote it has left this court."
              />
              <p
                id={reasonHintId}
                className={
                  reasonProblem === "too-long"
                    ? "text-xs text-destructive-text"
                    : "text-xs text-muted-foreground"
                }
              >
                Required, recorded with the transfer. {reason.trim().length}/{TRANSFER_REASON_MAX}
              </p>
            </div>

            {transfer.isError && (
              <Alert variant="destructive">
                <AlertDescription className="text-foreground">
                  {refusal ?? "The transfer didn't go through. Try again."}
                </AlertDescription>
              </Alert>
            )}
          </form>
        )}

        <DialogFooter>
          {result ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={transfer.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form="transfer-judgment-form"
                disabled={!canSubmit || transfer.isPending}
              >
                Transfer judgment
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
