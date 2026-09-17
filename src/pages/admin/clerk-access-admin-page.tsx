import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Check, X } from "lucide-react";
import { BrowseHeader, BrowsePage } from "@/components/browse";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { AlertDialog } from "@/components/ui/alert-dialog";
import {
  useDecideClerkAccessRequest,
  useOrphanedClerkAccessRequests,
  type ClerkRequestForReview,
} from "@/hooks/clerk/use-clerk-access-review";
import { ROUTES } from "@/routes/paths";
import { formatDate } from "@/lib/utils";

/**
 * Administrator fallback for clerk access requests that no CURRENTLY
 * authorized magistrate can act on. Administrators may approve or reject
 * directly (0151), or seat a magistrate so they can review going forward.
 */
export default function ClerkAccessAdminPage() {
  const { data: requests, isPending, isError, error, refetch } = useOrphanedClerkAccessRequests();
  const decide = useDecideClerkAccessRequest();
  const [rejectTarget, setRejectTarget] = useState<ClerkRequestForReview | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  return (
    <BrowsePage>
      <BrowseHeader
        title="Clerk Access: Unresolved Requests"
        description="Verified clerk access requests whose court currently has no magistrate authorized to review them. You can approve or reject here, or assign a magistrate on the roster."
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
            <Card
              key={r.id}
              className="border-[hsl(var(--notice-action)/0.35)] bg-[hsl(var(--notice-action)/0.08)]"
            >
              <CardContent className="flex flex-wrap items-start justify-between gap-4 py-4">
                <div>
                  <p className="font-medium text-foreground">
                    {r.profiles?.full_name || "Unnamed clerk"}
                  </p>
                  <p className="text-sm text-muted-foreground">{r.profiles?.email}</p>
                  <p className="mt-1 text-sm text-foreground">{r.courts?.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Requested {formatDate(r.requested_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => decide.mutate({ requestId: r.id, decision: "approved" })}
                    disabled={decide.isPending}
                  >
                    <Check className="h-4 w-4" />
                    Approve access
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRejectTarget(r);
                      setRejectReason("");
                    }}
                    disabled={decide.isPending}
                  >
                    <X className="h-4 w-4" />
                    Reject request
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link to={`${ROUTES.adminCourtAssignments}?tab=roster`}>
                      Assign a magistrate
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog
        open={!!rejectTarget}
        onOpenChange={(open) => !open && setRejectTarget(null)}
        title="Reject this clerk access request?"
        description={
          <div className="space-y-2">
            <p>
              {rejectTarget?.profiles?.full_name} will not be seated at {rejectTarget?.courts?.name}
              .
            </p>
            <Textarea
              placeholder="Reason (optional — shown to the clerk)"
              aria-label="Reason for rejecting (optional, shown to the clerk)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
        }
        confirmLabel="Reject request"
        isConfirming={decide.isPending}
        onConfirm={() => {
          if (!rejectTarget) return;
          decide.mutate(
            {
              requestId: rejectTarget.id,
              decision: "rejected",
              rejectionReason: rejectReason.trim() || undefined,
            },
            { onSuccess: () => setRejectTarget(null) },
          );
        }}
      />
    </BrowsePage>
  );
}
