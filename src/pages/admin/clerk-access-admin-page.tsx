import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { BrowseHeader, BrowsePage } from "@/components/browse";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { useOrphanedClerkAccessRequests } from "@/hooks/clerk/use-clerk-access-review";
import { ROUTES } from "@/routes/paths";
import { formatDate } from "@/lib/utils";

/**
 * Administrator fallback for clerk access requests that no CURRENTLY
 * authorized magistrate can act on — a court with no magistrate at all,
 * or several with none flagged `can_manage_clerks`. These requests are
 * never auto-approved; they stay genuinely pending until an admin
 * corrects the underlying magistrate_courts roster (via the existing
 * Court Assignments screen) so a real magistrate can review them.
 */
export default function ClerkAccessAdminPage() {
  const { data: requests, isPending, isError, error, refetch } = useOrphanedClerkAccessRequests();

  return (
    <BrowsePage>
      <BrowseHeader
        title="Clerk Access — Unresolved Requests"
        description="Verified clerk access requests whose court currently has no magistrate authorized to review them."
      />

      {isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : (requests ?? []).length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="Nothing unresolved"
          description="Every pending, verified clerk access request currently has an authorized magistrate who can review it."
        />
      ) : (
        <div className="max-w-2xl space-y-3">
          {(requests ?? []).map((r) => (
            <Card key={r.id} className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
                <div>
                  <p className="font-medium text-foreground">{r.profiles?.full_name || "Unnamed clerk"}</p>
                  <p className="text-sm text-muted-foreground">{r.profiles?.email}</p>
                  <p className="mt-1 text-sm text-foreground">{r.courts?.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Requested {formatDate(r.requested_at)}</p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to={ROUTES.adminCourtAssignments}>
                    Fix Court roster
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </BrowsePage>
  );
}
