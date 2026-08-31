import { useState } from "react";
import { Landmark, X } from "lucide-react";
import { BrowseHeader, BrowsePage } from "@/components/browse";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { useMagisterialDistricts } from "@/hooks/docket/use-lookups";
import {
  useCancelMagistrateCourtRequest,
  useCourtsForMagistrateRequest,
  useMyMagistrateCourtAssignments,
  useMyMagistrateCourtRequests,
  useRelinquishMagistrateCourt,
  useSubmitMagistrateCourtRequest,
  type MyMagistrateCourtAssignment,
} from "@/hooks/use-magistrate-court-requests";
import { formatDate } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  expired: "Expired",
};

const STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  approved: "default",
  rejected: "destructive",
  cancelled: "secondary",
  expired: "secondary",
};

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
  const { data: assignments, isPending, isError, error, refetch } = useMyMagistrateCourtAssignments();
  const { data: requests } = useMyMagistrateCourtRequests();
  const { data: districts } = useMagisterialDistricts();
  const { data: courts } = useCourtsForMagistrateRequest();
  const submit = useSubmitMagistrateCourtRequest();
  const cancel = useCancelMagistrateCourtRequest();
  const relinquish = useRelinquishMagistrateCourt();

  const [requestOpen, setRequestOpen] = useState(false);
  const [districtId, setDistrictId] = useState("");
  const [courtId, setCourtId] = useState("");
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  const [relinquishTarget, setRelinquishTarget] = useState<MyMagistrateCourtAssignment | null>(null);
  const [relinquishReason, setRelinquishReason] = useState("");

  const pendingRequests = (requests ?? []).filter((r) => r.status === "pending");
  const decidedRequests = (requests ?? []).filter((r) => r.status !== "pending");
  const courtsInDistrict = (courts ?? []).filter(
    (c) => c.district_id === districtId && c.status === "available",
  );

  function resetRequestForm() {
    setDistrictId("");
    setCourtId("");
    setRequestOpen(false);
  }

  return (
    <BrowsePage>
      <BrowseHeader
        title="Court Assignments"
        description="Your active primary court assignments and requests. The Docket belongs to the court, not to you personally — relinquishing a court preserves its entire history for your successor."
      />

      {isPending ? (
        <Skeleton className="h-40 w-full max-w-2xl" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : (assignments ?? []).length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No active court assignment"
          description="Request a court below. A Court Assignment Administrator reviews each request."
        />
      ) : (
        <div className="max-w-2xl space-y-3">
          {(assignments ?? []).map((a) => (
            <Card key={a.id} className="border-white/10 bg-white/5">
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="font-medium text-foreground">{a.courts?.name ?? "Unknown court"}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.courts?.magisterial_districts?.name ?? a.courts?.jurisdiction} · Since{" "}
                    {formatDate(a.started_at)} · {ASSIGNMENT_TYPE_LABEL[a.assignment_type] ?? a.assignment_type}
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

      {pendingRequests.length > 0 && (
        <div className="max-w-2xl space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Pending requests</h2>
          {pendingRequests.map((r) => (
            <Card key={r.id} className="border-white/10 bg-white/5">
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="font-medium text-foreground">{r.courts?.name ?? "Unknown court"}</p>
                  <p className="text-xs text-muted-foreground">Requested {formatDate(r.requested_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
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
            <Card key={r.id} className="border-white/10 bg-white/5">
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="font-medium text-foreground">{r.courts?.name ?? "Unknown court"}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.status === "rejected" && r.rejection_reason ? r.rejection_reason : formatDate(r.requested_at)}
                  </p>
                </div>
                <Badge variant={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!requestOpen ? (
        <Button variant="outline" onClick={() => setRequestOpen(true)}>
          Request another court
        </Button>
      ) : (
        <Card className="max-w-lg border-white/10 bg-white/5">
          <CardHeader>
            <CardTitle className="text-base">Request a court assignment</CardTitle>
            <CardDescription>
              A Court Assignment Administrator reviews and decides each requested court independently.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Magisterial District</label>
              <Select
                value={districtId}
                onChange={(e) => {
                  setDistrictId(e.target.value);
                  setCourtId("");
                }}
              >
                <option value="">Select a district…</option>
                {(districts ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Court</label>
              <Select value={courtId} onChange={(e) => setCourtId(e.target.value)} disabled={!districtId}>
                <option value="">
                  {!districtId
                    ? "Select a district first"
                    : courtsInDistrict.length === 0
                      ? "No available courts in this district"
                      : "Select a court…"}
                </option>
                {courtsInDistrict.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={resetRequestForm}>Cancel</Button>
              <Button
                disabled={!courtId || submit.isPending}
                onClick={() => submit.mutate({ courtId }, { onSuccess: resetRequestForm })}
              >
                Submit request
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
          if (pendingCancelId) cancel.mutate(pendingCancelId, { onSuccess: () => setPendingCancelId(null) });
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
                  {relinquishTarget.courts?.magisterial_districts?.name ?? relinquishTarget.courts?.jurisdiction} ·
                  Since {formatDate(relinquishTarget.started_at)} ·{" "}
                  {ASSIGNMENT_TYPE_LABEL[relinquishTarget.assignment_type] ?? relinquishTarget.assignment_type}
                </p>
              </div>
              <p className="rounded-sm border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Relinquishing this court will end your whole-court Docket access. The court's Docket
                and history will remain with the court and will become available to the successor
                magistrate.
              </p>
              <Textarea
                placeholder="Reason (optional)"
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
