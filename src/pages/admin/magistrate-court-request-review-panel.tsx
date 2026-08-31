import { useState } from "react";
import { Check, Gavel, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import {
  useAdminBootstrapSelfApprove,
  useDecideMagistrateCourtRequest,
  useIsSoleAdminBootstrapAvailable,
  useMagistrateCourtRequestsToReview,
  type MagistrateRequestForReview,
} from "@/hooks/admin/use-magistrate-court-requests";
import { formatDate } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  expired: "Expired",
};

/**
 * Court Assignment Administrator review console for magistrate court
 * requests. Mirrors clerk-access-requests-page.tsx's shape. The bootstrap
 * self-approval control (a request-specific action, never a general
 * capability) only ever renders for a request that is BOTH the caller's
 * own AND currently sole-administrator-eligible -- the RPC itself
 * independently re-verifies both, plus reason and JWT freshness, so this
 * is UI guidance, never the actual authorization boundary.
 */
export function MagistrateCourtRequestReviewPanel() {
  const { profile } = useAuth();
  const { data: requests, isPending, isError, error, refetch } = useMagistrateCourtRequestsToReview();
  const { data: bootstrapAvailable } = useIsSoleAdminBootstrapAvailable();
  const decide = useDecideMagistrateCourtRequest();
  const bootstrapApprove = useAdminBootstrapSelfApprove();

  const [rejectTarget, setRejectTarget] = useState<MagistrateRequestForReview | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [bootstrapTarget, setBootstrapTarget] = useState<MagistrateRequestForReview | null>(null);
  const [bootstrapReason, setBootstrapReason] = useState("");
  const [bootstrapPassword, setBootstrapPassword] = useState("");
  const [bootstrapReauthenticating, setBootstrapReauthenticating] = useState(false);

  const pending = (requests ?? []).filter((r) => r.status === "pending");
  const decided = (requests ?? []).filter((r) => r.status !== "pending");

  async function handleBootstrapConfirm() {
    if (!bootstrapTarget || !profile) return;
    if (!bootstrapReason.trim()) return;
    setBootstrapReauthenticating(true);
    try {
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: profile.email,
        password: bootstrapPassword,
      });
      if (reauthError) {
        throw new Error("Password incorrect — could not confirm your identity.");
      }
      await bootstrapApprove.mutateAsync({ requestId: bootstrapTarget.id, reason: bootstrapReason });
      setBootstrapTarget(null);
      setBootstrapReason("");
      setBootstrapPassword("");
    } catch {
      // Errors already surface via the mutation's own toast, or are
      // re-thrown above for the password-mismatch case -- caught here
      // only to stop the dialog closing on failure.
    } finally {
      setBootstrapReauthenticating(false);
    }
  }

  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (isError) return <InlineError error={error} onRetry={() => void refetch()} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Pending requests ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title="No pending requests"
            description="New magistrate court assignment requests will appear here."
          />
        ) : (
          <div className="space-y-3">
            {pending.map((r) => {
              const isOwnRequest = r.profile_id === profile?.id;
              const canBootstrap = isOwnRequest && !!bootstrapAvailable;
              return (
                <Card key={r.id} className="border-white/10 bg-white/5">
                  <CardContent className="flex flex-wrap items-start justify-between gap-4 py-4">
                    <div>
                      <p className="font-medium text-foreground">
                        {r.profiles?.full_name || "Unnamed"}
                        {isOwnRequest && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                      </p>
                      <p className="text-sm text-muted-foreground">{r.profiles?.email}</p>
                      <p className="mt-1 text-sm text-foreground">{r.courts?.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Requested {formatDate(r.requested_at)}
                        {r.staff_id ? ` · Staff ID ${r.staff_id}` : ""}
                      </p>
                      {r.note && <p className="mt-1 text-xs italic text-muted-foreground">"{r.note}"</p>}
                      {isOwnRequest && (
                        <p className="mt-2 flex items-center gap-1 text-xs text-amber-300">
                          <ShieldAlert className="h-3.5 w-3.5" />
                          You cannot approve your own request through the ordinary review flow.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!isOwnRequest ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => decide.mutate({ requestId: r.id, decision: "approved" })}
                            disabled={decide.isPending}
                          >
                            <Check className="h-4 w-4" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setRejectTarget(r); setRejectReason(""); }}
                            disabled={decide.isPending}
                          >
                            <X className="h-4 w-4" />
                            Reject
                          </Button>
                        </>
                      ) : canBootstrap ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
                          onClick={() => {
                            setBootstrapTarget(r);
                            setBootstrapReason("");
                            setBootstrapPassword("");
                          }}
                        >
                          <ShieldAlert className="h-4 w-4" />
                          Sole-administrator self-approve
                        </Button>
                      ) : (
                        <p className="max-w-[16rem] text-xs text-muted-foreground">
                          Ask another Court Assignment Administrator to review this request.
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {decided.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-foreground">History</h2>
          <div className="space-y-3">
            {decided.map((r) => (
              <Card key={r.id} className="border-white/10 bg-white/5">
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div>
                    <p className="font-medium text-foreground">{r.profiles?.full_name || "Unnamed"}</p>
                    <p className="text-sm text-muted-foreground">{r.courts?.name}</p>
                    {r.rejection_reason && (
                      <p className="mt-1 text-xs text-muted-foreground">{r.rejection_reason}</p>
                    )}
                    {r.approval_kind === "bootstrap_self_approval" && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-amber-300">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        Sole-administrator self-approval exception
                      </p>
                    )}
                  </div>
                  <Badge variant={r.status === "approved" ? "default" : "secondary"}>
                    {STATUS_LABEL[r.status]}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <AlertDialog
        open={!!rejectTarget}
        onOpenChange={(open) => !open && setRejectTarget(null)}
        title="Reject this request?"
        description={
          <div className="space-y-2">
            <p>
              {rejectTarget?.profiles?.full_name} will be notified that their request for{" "}
              {rejectTarget?.courts?.name} was not approved.
            </p>
            <Textarea
              placeholder="Optional reason (shown to the requester)"
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

      <Dialog open={!!bootstrapTarget} onOpenChange={(open) => !open && setBootstrapTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sole-administrator self-approval exception</DialogTitle>
            <DialogDescription>
              You are the only active Court Assignment Administrator, so there is no other
              administrator available to review your own request for{" "}
              <strong>{bootstrapTarget?.courts?.name}</strong>. This exception is recorded in the
              audit trail as a bootstrap self-approval, permanently distinguished from an ordinary
              decision. Once a second administrator exists, this exception is no longer available
              to anyone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bootstrap-reason">Reason (required)</Label>
              <Textarea
                id="bootstrap-reason"
                value={bootstrapReason}
                onChange={(e) => setBootstrapReason(e.target.value)}
                placeholder="Why this exception is necessary right now"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bootstrap-password">Confirm your password</Label>
              <Input
                id="bootstrap-password"
                type="password"
                autoComplete="current-password"
                value={bootstrapPassword}
                onChange={(e) => setBootstrapPassword(e.target.value)}
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Required to confirm this is really you before using the exception.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBootstrapTarget(null)}
              disabled={bootstrapReauthenticating || bootstrapApprove.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleBootstrapConfirm()}
              disabled={
                !bootstrapReason.trim() ||
                !bootstrapPassword ||
                bootstrapReauthenticating ||
                bootstrapApprove.isPending
              }
            >
              {bootstrapReauthenticating || bootstrapApprove.isPending ? "Confirming…" : "Approve my own request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
