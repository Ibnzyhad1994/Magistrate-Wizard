import { useState } from "react";
import { Check, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import {
  useDecideMagistrateCourtRequest,
  useMagistrateCourtRequestsToReview,
  useReturnUnassignedMagistrate,
} from "@/hooks/admin/use-magistrate-court-requests";
import {
  canSendUnassignedMagistrateBack,
  pendingRequestsForProfile,
  requestsForProfile,
} from "@/lib/court-assignment-roster";
import { formatDate } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  expired: "Expired",
};

/**
 * Roster-side request actions for one profile. Pending Requests is a
 * queue of open rows; people who cancelled still appear under Waiting
 * for assignment with only Assign unless this panel is shown.
 */
export function RosterProfileRequests({
  profileId,
  role,
  hasActiveAssignment,
}: {
  profileId: string;
  role?: string | null;
  hasActiveAssignment: boolean;
}) {
  const { profile } = useAuth();
  const { data: requests } = useMagistrateCourtRequestsToReview();
  const decide = useDecideMagistrateCourtRequest();
  const sendBack = useReturnUnassignedMagistrate();
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackReason, setSendBackReason] = useState("");

  const isOwnProfile = profileId === profile?.id;
  const mine = requestsForProfile(requests, profileId);
  const pending = pendingRequestsForProfile(requests, profileId);
  const decided = mine.filter((request) => request.status !== "pending");
  const canSendBack = canSendUnassignedMagistrateBack({
    role,
    hasActiveAssignment,
    isOwnProfile,
  });
  const rejectTarget = pending.find((request) => request.id === rejectTargetId) ?? null;

  if (!canSendBack && pending.length === 0 && decided.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Court requests</CardTitle>
        <CardDescription>
          {pending.length > 0
            ? "Reject an open request here, or send them back to pick the correct court."
            : "No open request. They cancelled or never submitted — send them back so they can request again."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {pending.map((request) => (
          <div
            key={request.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {request.courts?.name ?? "Unknown court"}
              </p>
              <p className="text-xs text-muted-foreground">
                Requested {formatDate(request.requested_at)}
              </p>
            </div>
            {!isOwnProfile && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => decide.mutate({ requestId: request.id, decision: "approved" })}
                  disabled={decide.isPending}
                >
                  <Check className="h-4 w-4" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRejectTargetId(request.id);
                    setRejectReason("");
                  }}
                  disabled={decide.isPending}
                >
                  <X className="h-4 w-4" />
                  Reject
                </Button>
              </div>
            )}
          </div>
        ))}

        {decided.slice(0, 4).map((request) => (
          <div key={request.id} className="flex items-center justify-between gap-2 text-sm">
            <p className="min-w-0 truncate text-muted-foreground">
              {request.courts?.name ?? "Unknown court"}
              {request.status === "rejected" && request.rejection_reason
                ? ` · ${request.rejection_reason}`
                : ""}
            </p>
            <Badge variant={request.status === "approved" ? "default" : "secondary"}>
              {STATUS_LABEL[request.status] ?? request.status}
            </Badge>
          </div>
        ))}

        {canSendBack && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSendBackOpen(true);
              setSendBackReason("");
            }}
            disabled={sendBack.isPending}
          >
            <Undo2 className="h-4 w-4" />
            Send back to requester
          </Button>
        )}
      </CardContent>

      <AlertDialog
        open={!!rejectTarget}
        onOpenChange={(open) => !open && setRejectTargetId(null)}
        title="Reject this request?"
        description={
          <div className="space-y-2">
            <p>
              {rejectTarget?.profiles?.full_name} will be notified that{" "}
              {rejectTarget?.courts?.name} was not approved. They can then request a
              different court.
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
          if (!rejectTarget) return;
          decide.mutate(
            {
              requestId: rejectTarget.id,
              decision: "rejected",
              rejectionReason: rejectReason || undefined,
            },
            { onSuccess: () => setRejectTargetId(null) },
          );
        }}
      />

      <AlertDialog
        open={sendBackOpen}
        onOpenChange={(open) => !open && setSendBackOpen(false)}
        title="Send this person back?"
        description={
          <div className="space-y-2">
            <p>
              They stay signed in as a magistrate with no court. Any open request is
              rejected, and they are notified to request the correct court. This does
              not turn the account into a clerk.
            </p>
            <Textarea
              placeholder="Reason shown to them (optional)"
              value={sendBackReason}
              onChange={(e) => setSendBackReason(e.target.value)}
            />
          </div>
        }
        confirmLabel="Send back"
        isConfirming={sendBack.isPending}
        onConfirm={() => {
          sendBack.mutate(
            { profileId, reason: sendBackReason || undefined },
            { onSuccess: () => setSendBackOpen(false) },
          );
        }}
      />
    </Card>
  );
}
