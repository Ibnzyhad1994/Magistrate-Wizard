import { useState } from "react";
import { Check, Undo2, Users } from "lucide-react";
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
  useCorrectUnassignedAccountType,
  useDecideMagistrateCourtRequest,
  useMagistrateCourtRequestsToReview,
  useReturnUnassignedMagistrate,
} from "@/hooks/admin/use-magistrate-court-requests";
import {
  canCorrectUnassignedAccountType,
  canSendUnassignedMagistrateBack,
  courtRequestStatusLabel,
  oppositeStaffAccountType,
  pendingRequestsForProfile,
  requestsForProfile,
} from "@/lib/court-assignment-roster";
import { ROLE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";

/**
 * Roster-side recovery for one profile: approve an open request, return
 * them to request again, or correct magistrate/clerk when they have no
 * active court. People who cancelled still appear under Waiting for
 * assignment; this panel is what makes them actionable besides Assign.
 */
export function RosterProfileRequests({
  profileId,
  role,
  hasActiveMagistrateAssignment,
  hasActiveClerkAssignment,
}: {
  profileId: string;
  role?: string | null;
  hasActiveMagistrateAssignment: boolean;
  hasActiveClerkAssignment: boolean;
}) {
  const { profile } = useAuth();
  const { data: requests } = useMagistrateCourtRequestsToReview();
  const decide = useDecideMagistrateCourtRequest();
  const sendBack = useReturnUnassignedMagistrate();
  const correctType = useCorrectUnassignedAccountType();
  const [returnRequestId, setReturnRequestId] = useState<string | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [sendBackReason, setSendBackReason] = useState("");
  const [correctOpen, setCorrectOpen] = useState(false);
  const [correctReason, setCorrectReason] = useState("");

  const isOwnProfile = profileId === profile?.id;
  const mine = requestsForProfile(requests, profileId);
  const pending = pendingRequestsForProfile(requests, profileId);
  const decided = mine.filter((request) => request.status !== "pending");
  const canSendBack = canSendUnassignedMagistrateBack({
    role,
    hasActiveAssignment: hasActiveMagistrateAssignment,
    isOwnProfile,
  });
  const canCorrect = canCorrectUnassignedAccountType({
    role,
    hasActiveMagistrateAssignment,
    hasActiveClerkAssignment,
    isOwnProfile,
  });
  const nextRole = oppositeStaffAccountType(role);
  const returnTarget = pending.find((request) => request.id === returnRequestId) ?? null;
  const showSendBack = canSendBack && pending.length === 0;

  if (!canSendBack && !canCorrect && pending.length === 0 && decided.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Court requests</CardTitle>
        <CardDescription>
          {pending.length > 0
            ? "Approve an open request, or return it so they can request again. This does not change account type."
            : showSendBack
              ? "No open request. Return them so they can request again, or correct the account type if they signed up as the wrong role."
              : canCorrect
                ? "No open magistrate request. If they signed up as the wrong account type, you can correct it here."
                : "Recent court requests for this profile."}
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
                    setReturnRequestId(request.id);
                    setReturnReason("");
                  }}
                  disabled={decide.isPending}
                >
                  <Undo2 className="h-4 w-4" />
                  Return to requester
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
              {courtRequestStatusLabel(request.status)}
            </Badge>
          </div>
        ))}

        {showSendBack && (
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
            Return to requester
          </Button>
        )}

        {canCorrect && nextRole && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCorrectOpen(true);
              setCorrectReason("");
            }}
            disabled={correctType.isPending}
          >
            <Users className="h-4 w-4" />
            Correct account type to {ROLE_LABELS[nextRole]}
          </Button>
        )}
      </CardContent>

      <AlertDialog
        open={!!returnTarget}
        onOpenChange={(open) => !open && setReturnRequestId(null)}
        title="Return this request to the requester?"
        description={
          <div className="space-y-2">
            <p>
              {returnTarget?.profiles?.full_name} will be asked to request again.{" "}
              {returnTarget?.courts?.name} will not be assigned. This does not change
              their account type.
            </p>
            <Textarea
              placeholder="Reason (required — shown to the requester)"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
            />
          </div>
        }
        confirmLabel="Return to requester"
        confirmDisabled={!returnReason.trim()}
        isConfirming={decide.isPending}
        onConfirm={() => {
          if (!returnTarget || !returnReason.trim()) return;
          decide.mutate(
            {
              requestId: returnTarget.id,
              decision: "rejected",
              rejectionReason: returnReason.trim(),
            },
            { onSuccess: () => setReturnRequestId(null) },
          );
        }}
      />

      <AlertDialog
        open={sendBackOpen}
        onOpenChange={(open) => !open && setSendBackOpen(false)}
        title="Return this person to request again?"
        description={
          <div className="space-y-2">
            <p>
              They stay signed in as a magistrate with no court. Any open request is
              closed, and they are notified to request again. This does not change
              their account type.
            </p>
            <Textarea
              placeholder="Reason (required — shown to them)"
              value={sendBackReason}
              onChange={(e) => setSendBackReason(e.target.value)}
            />
          </div>
        }
        confirmLabel="Return to requester"
        confirmDisabled={!sendBackReason.trim()}
        isConfirming={sendBack.isPending}
        onConfirm={() => {
          if (!sendBackReason.trim()) return;
          sendBack.mutate(
            { profileId, reason: sendBackReason.trim() },
            { onSuccess: () => setSendBackOpen(false) },
          );
        }}
      />

      <AlertDialog
        open={correctOpen}
        onOpenChange={(open) => !open && setCorrectOpen(false)}
        title={
          nextRole
            ? `Correct account type to ${ROLE_LABELS[nextRole]}?`
            : "Correct account type?"
        }
        description={
          <div className="space-y-2">
            <p>
              This changes them from {role === "magistrate" || role === "clerk" ? ROLE_LABELS[role] : "their current type"}{" "}
              to {nextRole ? ROLE_LABELS[nextRole] : "the other staff type"}. Open court
              or clerk-access requests are cancelled. They must refresh or sign in
              again, then request access on the correct page.
            </p>
            <Textarea
              placeholder="Reason (required — shown to them)"
              value={correctReason}
              onChange={(e) => setCorrectReason(e.target.value)}
            />
          </div>
        }
        confirmLabel={nextRole ? `Correct to ${ROLE_LABELS[nextRole]}` : "Correct account type"}
        confirmDisabled={!correctReason.trim() || !nextRole}
        isConfirming={correctType.isPending}
        onConfirm={() => {
          if (!nextRole || !correctReason.trim()) return;
          correctType.mutate(
            { profileId, newRole: nextRole, reason: correctReason.trim() },
            { onSuccess: () => setCorrectOpen(false) },
          );
        }}
      />
    </Card>
  );
}
