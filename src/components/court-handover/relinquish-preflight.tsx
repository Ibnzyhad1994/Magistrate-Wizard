import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { UseQueryResult } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/common/inline-error";
import { useRetainPartHeardMatter } from "@/hooks/use-court-handover";
import {
  judgmentLabel,
  matterLabel,
  pinFate,
  pinsToUnlink,
  preflightErrorMessage,
  type PinnedJudgment,
  type RelinquishPreflight,
} from "@/lib/court-handover";
import { formatDate } from "@/lib/utils";
import { ROUTES } from "@/routes/paths";

interface RelinquishPreflightProps {
  /** The pre-flight query, owned by the dialog so its confirm can wait on it. */
  preflight: UseQueryResult<RelinquishPreflight>;
  /**
   * `self`: the magistrate relinquishing their own court sees case numbers
   * and titles and can retain a matter. `admin`: an administrator ending
   * someone's assignment sees ids, statuses and dates only.
   */
  mode: "self" | "admin";
  /** Admin only: the transfer action for one pinned judgment. */
  renderTransfer?: (pin: PinnedJudgment, preflight: RelinquishPreflight) => ReactNode;
}

/**
 * What ending a court assignment leaves behind, shown before the confirm
 * step (BE-26): part-heard matters the magistrate has not retained, and the
 * judgment pins at the court, with the ones that will be unlinked.
 */
export function RelinquishPreflightSummary({
  preflight,
  mode,
  renderTransfer,
}: RelinquishPreflightProps) {
  if (preflight.isPending) {
    return (
      <div role="status" className="space-y-2">
        <span className="sr-only">Checking what this hand-over leaves behind…</span>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (preflight.isError) {
    const refusal = preflightErrorMessage(preflight.error);
    if (refusal) {
      return (
        <Alert variant="destructive">
          <AlertDescription className="text-foreground">{refusal}</AlertDescription>
        </Alert>
      );
    }
    return <InlineError error={preflight.error} onRetry={() => void preflight.refetch()} bare />;
  }

  const data = preflight.data;
  const unlinking = pinsToUnlink(data);

  return (
    <div className="space-y-4 text-sm">
      {mode === "admin" && (
        <p className="text-muted-foreground">
          {data.part_heard_unretained_count} part-heard{" "}
          {data.part_heard_unretained_count === 1 ? "matter" : "matters"} not retained ·{" "}
          {data.pinned_judgment_count} judgment {data.pinned_judgment_count === 1 ? "pin" : "pins"},{" "}
          {data.pins_to_unlink_count} to be unlinked. Case numbers and titles are shown to the
          magistrate only.
        </p>
      )}

      <PartHeardList data={data} mode={mode} />

      {unlinking.length > 0 && mode === "self" && (
        <Alert variant="warning" role="note">
          <AlertTitle>
            {unlinking.length === 1
              ? "1 judgment link will be removed"
              : `${unlinking.length} judgment links will be removed`}
          </AlertTitle>
          <AlertDescription className="space-y-2 text-foreground">
            <p>
              Nobody else can see these judgments, so once you leave the court their links to its
              matters are removed. The judgments themselves stay yours.
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              {unlinking.map((pin) => (
                <li key={pin.pin_id}>
                  <Link
                    to={ROUTES.judgmentDetail(pin.judgment_id)}
                    className="text-link underline-offset-2 hover:underline"
                  >
                    {judgmentLabel(pin)}
                  </Link>
                </li>
              ))}
            </ul>
            <p>
              To keep a link, mark the judgment discoverable, or ask an administrator to transfer it
              to the court&apos;s next magistrate before you relinquish.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {mode === "admin" && data.pinned_judgments.length > 0 && (
        <section aria-labelledby="handover-pins-heading" className="space-y-2">
          <h3 id="handover-pins-heading" className="eyebrow text-muted-foreground">
            Judgment pins at this court
          </h3>
          <ul className="divide-y divide-hairline rounded-md border border-hairline hc:border-border">
            {data.pinned_judgments.map((pin) => (
              <li
                key={pin.pin_id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
              >
                <span className="identifier text-foreground">{judgmentLabel(pin)}</span>
                <span className="text-muted-foreground">
                  {pin.judgment_status} · pinned {formatDate(pin.pinned_at)}
                </span>
                <span
                  className={
                    pin.will_unlink ? "font-medium text-foreground" : "text-muted-foreground"
                  }
                >
                  {pinFate(pin)}
                </span>
                {renderTransfer && <span className="ml-auto">{renderTransfer(pin, data)}</span>}
              </li>
            ))}
          </ul>
          {data.pins_to_unlink_count > 0 && (
            <p className="text-muted-foreground">
              To keep a link that will be removed, transfer its judgment to a magistrate sitting at
              this court before ending the assignment.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function PartHeardList({ data, mode }: { data: RelinquishPreflight; mode: "self" | "admin" }) {
  const retain = useRetainPartHeardMatter(data.assignment_id);
  const matters = data.part_heard_unretained;

  if (matters.length === 0) {
    return mode === "self" ? (
      <p className="text-muted-foreground">You have no part-heard matters here to retain.</p>
    ) : null;
  }

  return (
    <section aria-labelledby="handover-part-heard-heading" className="space-y-2">
      <h3 id="handover-part-heard-heading" className="eyebrow text-muted-foreground">
        Part-heard, not retained ({matters.length})
      </h3>
      {mode === "self" && (
        <p className="text-muted-foreground">
          You heard evidence in these. Retain one to keep working on it after you leave this court.
        </p>
      )}
      <ul className="divide-y divide-hairline rounded-md border border-hairline hc:border-border">
        {matters.map((matter) => (
          <li
            key={matter.docket_matter_id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              {mode === "self" && matter.case_number ? (
                <p className="text-foreground">
                  <span className="identifier">{matter.case_number}</span>
                  {matter.matter_title ? ` · ${matter.matter_title}` : ""}
                </p>
              ) : (
                <p className="identifier text-foreground">{matterLabel(matter)}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {matter.status}
                {matter.last_heard_on ? ` · last heard ${formatDate(matter.last_heard_on)}` : ""}
              </p>
            </div>
            {mode === "self" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={retain.isPending}
                onClick={() => retain.mutate(matter.docket_matter_id)}
                aria-label={`Retain ${matterLabel(matter)}`}
              >
                Retain
              </Button>
            )}
          </li>
        ))}
      </ul>
      {mode === "admin" && (
        <p className="text-xs text-muted-foreground">Only the magistrate can retain these.</p>
      )}
    </section>
  );
}
