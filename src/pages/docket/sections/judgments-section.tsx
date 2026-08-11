import { Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { useLinkedJudgments } from "@/hooks/docket/use-docket-links";

interface JudgmentsSectionProps {
  matterId: string;
}

/**
 * Read-only: linking a Judgment as reference material to a matter, or
 * un-linking it, is a Judgment-workspace action (Milestone 2), not
 * something this section writes to. RLS on the embedded `judgments` row
 * (owner-or-discoverable) is the only access boundary here — a linked
 * Judgment the current user cannot see simply won't appear.
 */
export function JudgmentsSection({ matterId }: JudgmentsSectionProps) {
  const { data, isPending, isError, error, refetch } = useLinkedJudgments(matterId);

  if (isPending) return <Skeleton className="mt-4 h-24 w-full" />;
  if (isError) return <InlineError className="mt-4" error={error} onRetry={() => void refetch()} />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        className="mt-4"
        icon={Scale}
        title="No linked judgments"
        description="Judgments linked as reference for this matter will appear here. Link them from the Judgment workspace."
      />
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {data.map((link) => {
        const judgment = link.judgments;
        if (!judgment) return null;
        return (
          <Card key={link.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div>
                <p className="font-medium text-foreground">{judgment.title}</p>
                <p className="text-sm text-muted-foreground">
                  {[judgment.case_number, judgment.citation].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
              <Badge variant={judgment.status === "finalized" ? "default" : "secondary"}>
                {judgment.status}
              </Badge>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
