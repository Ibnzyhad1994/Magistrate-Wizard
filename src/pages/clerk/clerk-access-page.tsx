import { useEffect, useRef, useState } from "react";
import { Gavel, X } from "lucide-react";
import { BrowseHeader, BrowsePage } from "@/components/browse";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
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
import { useAuth } from "@/hooks/use-auth";
import { useCourts, useMagisterialDistricts } from "@/hooks/docket/use-lookups";
import {
  notifyClerkAccess,
  useCancelClerkAccessRequest,
  useMyClerkAccessRequests,
  useSubmitClerkAccessRequest,
} from "@/hooks/clerk/use-clerk-access";
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

/**
 * Self-service surface for a clerk's own court-access requests. A clerk
 * reaches this page whether they have zero, some, or all of their
 * requests approved — it always shows the true, independent status of
 * every court they've asked for (never a single blended state), and lets
 * them cancel a pending request or request another court. No docket data
 * is fetched or shown here — this page is deliberately docket-free.
 */
export default function ClerkAccessPage() {
  const { profile } = useAuth();
  const { data: requests, isPending, isError, error, refetch } = useMyClerkAccessRequests();
  const { data: districts } = useMagisterialDistricts();
  const { data: courts } = useCourts();
  const submit = useSubmitClerkAccessRequest();
  const cancel = useCancelClerkAccessRequest();

  const [requestOpen, setRequestOpen] = useState(false);
  const [districtId, setDistrictId] = useState("");
  const [courtId, setCourtId] = useState("");
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);

  // Best-effort: a signup-time request (created by handle_new_user()
  // before the clerk's email was verified) never got a chance to notify
  // the magistrate then — do it now that this page is loading with a
  // verified session. The Edge Function itself is idempotent (skips any
  // request whose notified_magistrate_at is already set), so this is
  // safe to run on every mount, not just the first one.
  const notifiedRef = useRef(new Set<string>());
  useEffect(() => {
    for (const r of requests ?? []) {
      if (r.status === "pending" && !r.notified_magistrate_at && !notifiedRef.current.has(r.id)) {
        notifiedRef.current.add(r.id);
        void notifyClerkAccess("request_created", r.id);
      }
    }
  }, [requests]);

  const approvedCount = (requests ?? []).filter((r) => r.status === "approved").length;
  const requestedCourtIds = new Set((requests ?? []).map((r) => r.court_id));
  const courtsInDistrict = (courts ?? []).filter(
    (c) => c.district_id === districtId && !requestedCourtIds.has(c.id),
  );

  function resetRequestForm() {
    setDistrictId("");
    setCourtId("");
    setRequestOpen(false);
  }

  return (
    <BrowsePage>
      <BrowseHeader
        title="Clerk Access"
        description="Your court access requests. Approval is granted per court by that court's magistrate."
      />

      {approvedCount === 0 && !isPending && (
        <Card className="max-w-2xl border-white/10 bg-white/5">
          <CardContent className="flex items-start gap-4 pt-6">
            <Gavel className="mt-0.5 h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="font-medium text-foreground">
                Welcome, {profile?.full_name?.trim() || "Clerk"}.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {(requests ?? []).length > 0
                  ? "Your request is awaiting approval from the assigned magistrate. You'll get full access to that court's docket as soon as it's approved."
                  : "Request access to a court below to get started. The court's assigned magistrate will review your request."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {isPending ? (
        <Skeleton className="h-40 w-full max-w-2xl" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : (requests ?? []).length === 0 ? (
        <EmptyState icon={Gavel} title="No court access requested yet" description="Request access to a court to begin." />
      ) : (
        <div className="max-w-2xl space-y-3">
          {(requests ?? []).map((r) => (
            <Card key={r.id} className="border-white/10 bg-white/5">
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="font-medium text-foreground">{r.courts?.name ?? "Unknown court"}</p>
                  <p className="text-xs text-muted-foreground">
                    Requested {formatDate(r.requested_at)}
                    {r.status === "rejected" && r.rejection_reason ? ` · ${r.rejection_reason}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  {r.status === "pending" && (
                    <Button size="icon" variant="ghost" aria-label="Cancel request" onClick={() => setPendingCancelId(r.id)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!requestOpen ? (
        <Button variant="outline" onClick={() => setRequestOpen(true)}>
          Request access to another court
        </Button>
      ) : (
        <Card className="max-w-lg border-white/10 bg-white/5">
          <CardHeader>
            <CardTitle className="text-base">Request court access</CardTitle>
            <CardDescription>Your request goes to that court's assigned magistrate for approval.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Magisterial District</label>
              <Select value={districtId} onChange={(e) => { setDistrictId(e.target.value); setCourtId(""); }}>
                <option value="">Select a district…</option>
                {(districts ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Court</label>
              <Select value={courtId} onChange={(e) => setCourtId(e.target.value)} disabled={!districtId}>
                <option value="">{districtId ? "Select a court…" : "Select a district first"}</option>
                {courtsInDistrict.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={resetRequestForm}>Cancel</Button>
              <Button
                disabled={!courtId || submit.isPending}
                onClick={() =>
                  submit.mutate(
                    { courtId },
                    { onSuccess: resetRequestForm },
                  )
                }
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
    </BrowsePage>
  );
}
