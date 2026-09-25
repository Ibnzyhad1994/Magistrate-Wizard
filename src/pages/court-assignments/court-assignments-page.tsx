import { useId, useState } from "react";
import { Landmark, ShieldAlert, X } from "lucide-react";
import { BrowseHeader, BrowsePage } from "@/components/browse";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { statusBadgeVariant } from "@/components/common/status-badge-variant";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import { useMagisterialDistricts } from "@/hooks/docket/use-lookups";
import {
  useCancelMagistrateCourtRequest,
  useCourtsForMagistrateRequest,
  useMyEndedMagistrateCourtAssignments,
  useMyMagistrateCourtAssignments,
  useMyMagistrateCourtRequests,
  useRelinquishMagistrateCourt,
  useSubmitMagistrateCourtRequest,
  type MyMagistrateCourtAssignment,
} from "@/hooks/use-magistrate-court-requests";
import {
  COURT_REQUEST_RETURN_NEXT_STEP,
  courtRequestStatusLabel,
} from "@/lib/court-assignment-roster";
import { OCCUPIED_COURT_EXCEPTION_LABEL } from "@/lib/occupied-court-exception";
import { formatDate } from "@/lib/utils";

const ASSIGNMENT_TYPE_LABEL: Record<string, string> = {
  regular: "Primary",
  acting: "Acting",
  relief: "Relief",
  other: "Other",
};

/**
 * Self-service surface for a magistrate's (or an admin who is also a
 * sitting magistrate's) own court assignments and requests. Mirrors
 * clerk-access-page.tsx's shape. "Active primary court assignment," not
 * "ownership" -- the Docket belongs to the court, and relinquishing one
 * never touches it (see relinquish_magistrate_court(), 0108).
 */
export default function CourtAssignmentsPage() {
  const { profile } = useAuth();
  const {
    data: assignments,
    isPending,
    isError,
    error,
    refetch,
  } = useMyMagistrateCourtAssignments();
  const { data: endedAssignments } = useMyEndedMagistrateCourtAssignments();
  const { data: requests, isPending: requestsPending } = useMyMagistrateCourtRequests();
  const { data: districts } = useMagisterialDistricts();
  const { data: courts } = useCourtsForMagistrateRequest();
  const submit = useSubmitMagistrateCourtRequest();
  const cancel = useCancelMagistrateCourtRequest();
  const relinquish = useRelinquishMagistrateCourt();

  const [requestOpen, setRequestOpen] = useState<boolean | null>(null);
  const [districtId, setDistrictId] = useState("");
  const [courtId, setCourtId] = useState("");
  const districtSelectId = useId();
  const courtSelectId = useId();
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  const [relinquishTarget, setRelinquishTarget] = useState<MyMagistrateCourtAssignment | null>(
    null,
  );
  const [relinquishReason, setRelinquishReason] = useState("");

  const pendingRequests = (requests ?? []).filter((r) => r.status === "pending");
  const decidedRequests = (requests ?? []).filter((r) => r.status !== "pending");
  const latestOutcome = decidedRequests.find(
    (r) => r.status === "rejected" || r.status === "cancelled",
  );
  const latestReturned = latestOutcome?.status === "rejected" ? latestOutcome : undefined;
  const latestCancelled = latestOutcome?.status === "cancelled" ? latestOutcome : undefined;
  const courtsInDistrict = (courts ?? []).filter(
    (c) => c.district_id === districtId && (c.status === "available" || c.status === "assigned"),
  );
  const selectedCourt = courtsInDistrict.find((c) => c.id === courtId);
  const requestingOccupied = selectedCourt?.status === "assigned";
  const hasAssignment = (assignments ?? []).length > 0;
  const awaitingFirstRequest =
    !isPending && !requestsPending && !hasAssignment && pendingRequests.length === 0;
  const showRequestForm = requestOpen ?? awaitingFirstRequest;

  function resetRequestForm() {
    setDistrictId("");
    setCourtId("");
    setRequestOpen(false);
  }

  return (
    <BrowsePage>
      <BrowseHeader
        title="Court Assignments"
        description="Your courts and requests. The docket belongs to the court, so if you give one up, its history stays for the next magistrate."
      />

      {profile?.role === "magistrate" && !isPending && (assignments ?? []).length === 0 && (
        <Card className="max-w-2xl border-[hsl(var(--notice-action)/0.35)] bg-[hsl(var(--notice-action)/0.08)]">
          <CardContent className="flex items-start gap-4 pt-6">
            <ShieldAlert
              className="mt-0.5 h-6 w-6 shrink-0 text-notice-action"
              aria-hidden="true"
            />
            <div>
              <p className="font-medium text-foreground">
                {pendingRequests.length > 0
                  ? "Access is limited until a court is approved."
                  : latestReturned
                    ? "Your court request was returned."
                    : latestCancelled
                      ? "You cancelled this request."
                      : "Access is limited until a court is approved."}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {pendingRequests.length > 0
                  ? "Your request is waiting for review. Once approved, you'll have full access to that court's docket."
                  : latestReturned
                    ? COURT_REQUEST_RETURN_NEXT_STEP
                    : latestCancelled
                      ? "You cancelled this request. Request again when you are sure of the court."
                      : "Request a court below to get started. You'll have access to the rest of the app once it's approved."}
              </p>
              {latestReturned?.rejection_reason && pendingRequests.length === 0 && (
                <p className="mt-2 text-sm text-foreground">
                  Reason: {latestReturned.rejection_reason}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isPending ? (
        <Skeleton className="h-40 w-full max-w-2xl" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : (assignments ?? []).length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No active court assignment"
          description="Request a court below. An administrator reviews each one."
        />
      ) : (
        <div className="max-w-2xl space-y-3">
          {(assignments ?? []).map((a) => (
            <Card key={a.id} className="border-border bg-foreground/5">
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="font-medium text-foreground">{a.courts?.name ?? "Unknown court"}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.courts?.magisterial_districts?.name ?? a.courts?.jurisdiction} · Since{" "}
                    {formatDate(a.started_at)} ·{" "}
                    {ASSIGNMENT_TYPE_LABEL[a.assignment_type] ?? a.assignment_type}
                  </p>
                </div>
                {a.assignment_type === "regular" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRelinquishTarget(a);
                      setRelinquishReason("");
                    }}
                  >
                    Relinquish
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(endedAssignments ?? []).length > 0 && (
        // Collapsed by default: this is history, but it is the ONLY place a
        // magistrate whose sitting was ended without their involvement
        // (first-sign-in occupancy, admin replace / transfer) can read why.
        <details className="max-w-2xl rounded-md border border-border">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-foreground">
            Ended assignments ({(endedAssignments ?? []).length})
          </summary>
          <div className="space-y-2 border-t border-border p-3">
            {(endedAssignments ?? []).map((a) => (
              <Card key={a.id} className="border-border bg-foreground/5">
                <CardContent className="py-3">
                  <p className="font-medium text-foreground">{a.courts?.name ?? "Unknown court"}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.courts?.magisterial_districts?.name ?? a.courts?.jurisdiction} ·{" "}
                    {ASSIGNMENT_TYPE_LABEL[a.assignment_type] ?? a.assignment_type} ·{" "}
                    {formatDate(a.started_at)} to {formatDate(a.ended_at)}
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    {a.end_reason ?? "No reason recorded."}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </details>
      )}

      {pendingRequests.length > 0 && (
        <div className="max-w-2xl space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Pending requests</h2>
          {pendingRequests.map((r) => (
            <Card key={r.id} className="border-border bg-foreground/5">
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="font-medium text-foreground">{r.courts?.name ?? "Unknown court"}</p>
                  <p className="text-xs text-muted-foreground">
                    Requested {formatDate(r.requested_at)}
                  </p>
                  {r.request_kind === "occupied_exception" && (
                    <p className="mt-1 text-xs text-notice-action">
                      {OCCUPIED_COURT_EXCEPTION_LABEL}: waiting for an administrator to replace the
                      current magistrate or seat you alongside them.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusBadgeVariant(r.status)}>
                    {courtRequestStatusLabel(r.status)}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Cancel request"
                    onClick={() => setPendingCancelId(r.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {decidedRequests.length > 0 && (
        <div className="max-w-2xl space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Request history</h2>
          {decidedRequests.map((r) => (
            <Card key={r.id} className="border-border bg-foreground/5">
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="font-medium text-foreground">{r.courts?.name ?? "Unknown court"}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.status === "rejected" && r.rejection_reason
                      ? r.rejection_reason
                      : formatDate(r.requested_at)}
                  </p>
                </div>
                <Badge variant={statusBadgeVariant(r.status)}>
                  {courtRequestStatusLabel(r.status)}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!showRequestForm ? (
        isPending || requestsPending ? null : (
          <Button variant="outline" onClick={() => setRequestOpen(true)}>
            {hasAssignment ? "Request another court" : "Request a court"}
          </Button>
        )
      ) : (
        <Card className="max-w-lg border-border bg-foreground/5">
          <CardHeader>
            <CardTitle className="text-base">Request a court assignment</CardTitle>
            <CardDescription>
              An administrator reviews each request. For an occupied court, they decide whether to
              replace the magistrate there or seat you both.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor={districtSelectId} className="text-sm font-medium text-foreground">
                Magisterial District
              </label>
              <Select
                id={districtSelectId}
                value={districtId}
                onChange={(e) => {
                  setDistrictId(e.target.value);
                  setCourtId("");
                }}
              >
                <option value="">Select a district…</option>
                {(districts ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={courtSelectId} className="text-sm font-medium text-foreground">
                Court
              </label>
              <Select
                id={courtSelectId}
                value={courtId}
                onChange={(e) => setCourtId(e.target.value)}
                disabled={!districtId}
              >
                <option value="">
                  {!districtId
                    ? "Select a district first"
                    : courtsInDistrict.length === 0
                      ? "No courts in this district"
                      : "Select a court…"}
                </option>
                {courtsInDistrict.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.status === "assigned" ? " (occupied — special exception)" : ""}
                  </option>
                ))}
              </Select>
            </div>
            {requestingOccupied && (
              <p className="text-xs text-notice-action">
                This court already has a magistrate. An administrator will decide whether to replace
                them or seat you both.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={resetRequestForm}>
                Cancel
              </Button>
              <Button
                disabled={!courtId || submit.isPending}
                onClick={() => submit.mutate({ courtId }, { onSuccess: resetRequestForm })}
              >
                {requestingOccupied ? "Request exception" : "Submit request"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={!!pendingCancelId}
        onOpenChange={(open) => !open && setPendingCancelId(null)}
        title="Cancel this request?"
        description="You can request this court again later if you change your mind."
        confirmLabel="Cancel request"
        isConfirming={cancel.isPending}
        onConfirm={() => {
          if (pendingCancelId)
            cancel.mutate(pendingCancelId, { onSuccess: () => setPendingCancelId(null) });
        }}
      />

      <AlertDialog
        open={!!relinquishTarget}
        onOpenChange={(open) => !open && setRelinquishTarget(null)}
        title="Relinquish this court?"
        confirmLabel="Relinquish court"
        isConfirming={relinquish.isPending}
        description={
          relinquishTarget ? (
            <div className="space-y-3">
              <div className="text-sm">
                <p className="font-medium text-foreground">{relinquishTarget.courts?.name}</p>
                <p className="text-muted-foreground">
                  {relinquishTarget.courts?.magisterial_districts?.name ??
                    relinquishTarget.courts?.jurisdiction}{" "}
                  · Since {formatDate(relinquishTarget.started_at)} ·{" "}
                  {ASSIGNMENT_TYPE_LABEL[relinquishTarget.assignment_type] ??
                    relinquishTarget.assignment_type}
                </p>
              </div>
              <p className="rounded-sm border-[hsl(var(--notice-action)/0.35)] bg-[hsl(var(--notice-action)/0.1)] px-3 py-2 text-xs text-notice-action">
                You&apos;ll lose access to this court&apos;s docket. Its files and history stay with
                the court for the next magistrate.
              </p>
              <Textarea
                placeholder="Reason (optional)"
                aria-label="Reason for relinquishing (optional)"
                value={relinquishReason}
                onChange={(e) => setRelinquishReason(e.target.value)}
              />
            </div>
          ) : undefined
        }
        onConfirm={() => {
          if (!relinquishTarget) return;
          relinquish.mutate(
            { assignmentId: relinquishTarget.id, reason: relinquishReason || undefined },
            { onSuccess: () => setRelinquishTarget(null) },
          );
        }}
      />
    </BrowsePage>
  );
}
