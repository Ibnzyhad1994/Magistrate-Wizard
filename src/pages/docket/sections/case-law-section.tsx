import { BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { useLinkedCaseLaw } from "@/hooks/docket/use-docket-links";

interface CaseLawSectionProps {
  matterId: string;
}

/**
 * Read-only, same model as JudgmentsSection: RLS on the embedded
 * `case_law` row (canonical-or-owned) governs what's visible — no
 * privacy exposure is possible via the Docket association alone.
 */
export function CaseLawSection({ matterId }: CaseLawSectionProps) {
  const { data, isPending, isError, error, refetch } = useLinkedCaseLaw(matterId);

  if (isPending) return <Skeleton className="mt-4 h-24 w-full" />;
  if (isError) return <InlineError className="mt-4" error={error} onRetry={() => void refetch()} />;
  if (!data || data.length === 0) {
    return (
      <EmptyState
        className="mt-4"
        icon={BookOpen}
        title="No linked case law"
        description="Case law linked as authority for this matter will appear here. Link it from Case Law research."
      />
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {data.map((link) => {
        const caseLaw = link.case_law;
        if (!caseLaw) return null;
        return (
          <Card key={link.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div>
                <p className="font-medium text-foreground">{caseLaw.case_name}</p>
                <p className="text-sm text-muted-foreground">
                  {[caseLaw.citation, caseLaw.court, caseLaw.jurisdiction]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {caseLaw.owner_id ? (
                <Badge variant="secondary">Personal</Badge>
              ) : (
                <Badge variant="canonical">Canonical</Badge>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
