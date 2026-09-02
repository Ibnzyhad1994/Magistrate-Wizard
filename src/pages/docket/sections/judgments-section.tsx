import { useState } from "react";
import { Plus, Scale, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HintTooltip } from "@/components/ui/tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { useLinkedJudgments } from "@/hooks/docket/use-docket-links";
import { useDeleteDocketJudgmentLink } from "@/hooks/docket/use-docket-judgment-links";
import { LinkJudgmentDialog } from "@/pages/docket/link-judgment-dialog";
import { useDocketMatterAccess } from "@/hooks/docket/use-docket-matter-access";
import { toTitleCase } from "@/lib/utils";
import { NOT_SET } from "@/lib/empty-display";

interface JudgmentsSectionProps {
  matterId: string;
  frozen?: boolean;
}

/**
 * Linking/unlinking a Judgment as reference material for this matter
 * happens here (the live `docket_matter_judgments` INSERT/DELETE
 * policies require the caller to own the Judgment being linked, in
 * addition to lawful Docket access — see use-docket-judgment-links.ts).
 * RLS on the embedded `judgments` row (owner-or-discoverable) still
 * governs read visibility — a linked Judgment the current user cannot
 * see simply won't appear here.
 */
export function JudgmentsSection({ matterId, frozen = false }: JudgmentsSectionProps) {
  const { data, isPending, isError, error, refetch } = useLinkedJudgments(matterId);
  const { data: access } = useDocketMatterAccess(matterId);
  const canManage = (access?.canManage ?? false) && !frozen;
  const deleteLink = useDeleteDocketJudgmentLink(matterId);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);

  const linkedJudgmentIds = (data ?? []).map((link) => link.judgment_id);

  if (isPending) return <Skeleton className="mt-4 h-24 w-full" />;
  if (isError) return <InlineError className="mt-4" error={error} onRetry={() => void refetch()} />;

  return (
    <div className="mt-4 space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setLinkDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Link Judgment
          </Button>
        </div>
      )}

      {!data || data.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No linked judgments"
          description="Judgments linked as reference for this matter will appear here."
          action={
            canManage ? (
              <Button size="sm" onClick={() => setLinkDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                Link a Judgment
              </Button>
            ) : undefined
          }
        />
      ) : (
        data.map((link) => {
          const judgment = link.judgments;
          if (!judgment) return null;
          return (
            <Card key={link.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <p className="font-medium text-foreground">{judgment.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {[judgment.case_number, judgment.citation].filter(Boolean).join(" · ") || NOT_SET}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={judgment.status === "final" ? "default" : "secondary"}>
                    {toTitleCase(judgment.status)}
                  </Badge>
                  {canManage && (
                    <HintTooltip label="Unlink">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      aria-label={`Unlink judgment ${judgment.title}`}
                      disabled={deleteLink.isPending}
                      onClick={() =>
                        deleteLink.mutate({ linkId: link.id, judgmentId: judgment.id })
                      }
                    >
                      {deleteLink.isPending ? <LoadingSpinner size={14} /> : <X className="h-4 w-4" />}
                    </Button>
                    </HintTooltip>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      <LinkJudgmentDialog
        matterId={matterId}
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        linkedJudgmentIds={linkedJudgmentIds}
      />
    </div>
  );
}
