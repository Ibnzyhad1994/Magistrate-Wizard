import { useState } from "react";
import { Check, X, UserMinus, Gavel } from "lucide-react";
import { BrowseHeader, BrowsePage } from "@/components/browse";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { AlertDialog } from "@/components/ui/alert-dialog";
import {
  useClerkAccessRequestsToReview,
  useClerkRoster,
  useDecideClerkAccessRequest,
  useRevokeClerkCourtAccess,
  type ClerkRequestForReview,
} from "@/hooks/clerk/use-clerk-access-review";
import { formatDate } from "@/lib/utils";

/**
 * Magistrate-only "Clerk Access" review console. RLS scopes every row
 * shown here to courts the signed-in magistrate is currently authorized
 * to manage (can_manage_clerk_access()) — this page never needs to filter
 * by court itself; if it's visible here, this magistrate may act on it.
 */
export default function ClerkAccessRequestsPage() {
  const { data: requests, isPending, isError, error, refetch } = useClerkAccessRequestsToReview();
  const { data: roster } = useClerkRoster();
  const decide = useDecideClerkAccessRequest();
  const revoke = useRevokeClerkCourtAccess();

  const [rejectTarget, setRejectTarget] = useState<ClerkRequestForReview | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; label: string } | null>(null);

  const pending = (requests ?? []).filter((r) => r.status === "pending");
  const decided = (requests ?? []).filter((r) => r.status !== "pending");
  const activeRoster = (roster ?? []).filter((r) => !r.ended_at);
  const revokedRoster = (roster ?? []).filter((r) => r.ended_at);

  return (
    <BrowsePage>
      <BrowseHeader
        title="Clerk Access"
        description="Requests and approved clerks for the courts you currently manage."
      />

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : (
        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
            <TabsTrigger value="roster">Approved clerks ({activeRoster.length})</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="pending">
            {pending.length === 0 ? (
              <EmptyState icon={Gavel} className="mt-4" title="No pending requests" description="New clerk access requests for your courts will appear here." />
            ) : (
              <div className="mt-4 space-y-3">
                {pending.map((r) => (
                  <Card key={r.id} className="border-white/10 bg-white/5">
                    <CardContent className="flex flex-wrap items-start justify-between gap-4 py-4">
                      <div>
                        <p className="font-medium text-foreground">{r.profiles?.full_name || "Unnamed clerk"}</p>
                        <p className="text-sm text-muted-foreground">{r.profiles?.email}</p>
                        <p className="mt-1 text-sm text-foreground">{r.courts?.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Requested {formatDate(r.requested_at)}
                          {r.staff_id ? ` · Staff ID ${r.staff_id}` : ""}
                        </p>
                        {r.note && <p className="mt-1 text-xs italic text-muted-foreground">"{r.note}"</p>}
                      </div>
                      <div className="flex gap-2">
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
                          onClick={() => { setRejectTarget(r); setRejectReason(""); }}
                          disabled={decide.isPending}
                        >
                          <X className="h-4 w-4" />
                          Reject request
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="roster">
            {activeRoster.length === 0 ? (
              <EmptyState icon={Gavel} className="mt-4" title="No approved clerks yet" description="Clerks you approve will appear here." />
            ) : (
              <div className="mt-4 space-y-3">
                {activeRoster.map((row) => (
                  <Card key={row.id} className="border-white/10 bg-white/5">
                    <CardContent className="flex items-center justify-between gap-4 py-4">
                      <div>
                        <p className="font-medium text-foreground">{row.profiles?.full_name || "Unnamed clerk"}</p>
                        <p className="text-sm text-muted-foreground">{row.profiles?.email}</p>
                        <p className="mt-1 text-sm text-foreground">{row.courts?.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Approved {formatDate(row.started_at)}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRevokeTarget({ id: row.id, label: row.profiles?.full_name || "this clerk" })}
                      >
                        <UserMinus className="h-4 w-4" />
                        Revoke access
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history">
            <div className="mt-4 space-y-3">
              {decided.map((r) => (
                <Card key={r.id} className="border-white/10 bg-white/5">
                  <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div>
                      <p className="font-medium text-foreground">{r.profiles?.full_name || "Unnamed clerk"}</p>
                      <p className="text-sm text-muted-foreground">{r.courts?.name}</p>
                      {r.rejection_reason && <p className="mt-1 text-xs text-muted-foreground">{r.rejection_reason}</p>}
                    </div>
                    <Badge variant={r.status === "approved" ? "default" : "secondary"}>
                      {r.status === "approved" ? "Approved" : r.status === "rejected" ? "Rejected" : r.status === "cancelled" ? "Cancelled" : "Expired"}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
              {revokedRoster.map((row) => (
                <Card key={row.id} className="border-white/10 bg-white/5">
                  <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div>
                      <p className="font-medium text-foreground">{row.profiles?.full_name || "Unnamed clerk"}</p>
                      <p className="text-sm text-muted-foreground">{row.courts?.name}</p>
                      {row.end_reason && <p className="mt-1 text-xs text-muted-foreground">{row.end_reason}</p>}
                    </div>
                    <Badge variant="destructive">Revoked</Badge>
                  </CardContent>
                </Card>
              ))}
              {decided.length === 0 && revokedRoster.length === 0 && (
                <EmptyState icon={Gavel} title="No history yet" description="Decided requests and revoked assignments will appear here." />
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}

      <AlertDialog
        open={!!rejectTarget}
        onOpenChange={(open) => !open && setRejectTarget(null)}
        title="Reject this request?"
        description={
          <div className="space-y-2">
            <p>{rejectTarget?.profiles?.full_name} will be notified that their request for {rejectTarget?.courts?.name} was not approved.</p>
            <Textarea
              placeholder="Optional reason (shown to the clerk)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
        }
        confirmLabel="Reject request"
        isConfirming={decide.isPending}
        onConfirm={() => {
          if (rejectTarget) {
            decide.mutate(
              { requestId: rejectTarget.id, decision: "rejected", rejectionReason: rejectReason || undefined },
              { onSuccess: () => setRejectTarget(null) },
            );
          }
        }}
      />

      <AlertDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke court access?"
        description={`${revokeTarget?.label} will immediately lose access to this court's docket. This does not affect any other court they may be approved for.`}
        confirmLabel="Revoke access"
        isConfirming={revoke.isPending}
        onConfirm={() => {
          if (revokeTarget) revoke.mutate({ assignmentId: revokeTarget.id }, { onSuccess: () => setRevokeTarget(null) });
        }}
      />
    </BrowsePage>
  );
}
