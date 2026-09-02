import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Landmark, Plus } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import { useCourts } from "@/hooks/docket/use-lookups";
import { useMyMagistrateCourtAssignments } from "@/hooks/use-magistrate-court-requests";
import {
  useCreateCourtAssignment,
  useEndCourtAssignment,
} from "@/hooks/admin/use-court-assignments";
import { ROLE_LABELS, type UserRole } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { ROUTES } from "@/routes/paths";

const ASSIGNMENT_TYPE_LABEL: Record<string, string> = {
  regular: "Primary",
  acting: "Acting",
  relief: "Relief",
  other: "Other",
};

/**
 * Settings-only self-seating for an administrator. Creates an Acting
 * magistrate_courts row (0110 forbids a silent self-assign of Primary)
 * so the Docket "New matter" path works without replacing whoever already
 * sits that court as the primary magistrate.
 */
export function AdminSelfCourtCard() {
  const { profile } = useAuth();
  const { data: assignments, isPending: assignmentsPending } = useMyMagistrateCourtAssignments();
  const { data: courts, isPending: courtsPending } = useCourts();
  const createAssignment = useCreateCourtAssignment(profile?.id ?? "");
  const endAssignment = useEndCourtAssignment(profile?.id ?? "");

  const [courtToAssign, setCourtToAssign] = useState("");
  const [endTarget, setEndTarget] = useState<{ id: string; courtName: string } | null>(null);

  const assignedCourtIds = new Set((assignments ?? []).map((row) => row.court_id));
  const availableCourts = (courts ?? []).filter((court) => !assignedCourtIds.has(court.id));

  const handleAssign = () => {
    if (!courtToAssign || !profile?.id) return;
    createAssignment.mutate(
      { courtId: courtToAssign, assignmentType: "acting" },
      { onSuccess: () => setCourtToAssign("") },
    );
  };

  return (
    <>
      <Card className="mt-6 max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Court Assignments</CardTitle>
          <CardDescription>
            Platform role: <strong>{ROLE_LABELS[profile?.role as UserRole]}</strong>.
            Seat yourself at a court here so you can create docket matters. This
            uses an Acting assignment — it does not replace a sitting primary
            magistrate. For someone else, use{" "}
            <Link to={ROUTES.adminCourtAssignments} className="underline underline-offset-2">
              Manage Court Assignments
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {assignmentsPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (assignments ?? []).length > 0 ? (
            <ul className="divide-y divide-border">
              {(assignments ?? []).map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2 py-2 first:pt-0">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                      <Landmark className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {row.courts?.name ?? "Unknown court"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {ASSIGNMENT_TYPE_LABEL[row.assignment_type] ?? row.assignment_type}
                      {" · Since "}
                      {formatDate(row.started_at)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setEndTarget({ id: row.id, courtName: row.courts?.name ?? "this court" })
                    }
                  >
                    End
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              You are not currently seated at a court. Assign one below to use the Docket.
            </p>
          )}

          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <div className="min-w-[12rem] flex-1 space-y-1.5">
              <Label htmlFor="admin-self-court">Seat yourself at</Label>
              <Select
                id="admin-self-court"
                value={courtToAssign}
                onChange={(e) => setCourtToAssign(e.target.value)}
                disabled={courtsPending || availableCourts.length === 0}
                aria-label="Court to assign to yourself"
              >
                <option value="">
                  {!courtsPending && availableCourts.length === 0
                    ? "No further active courts"
                    : "Select a court…"}
                </option>
                {availableCourts.map((court) => (
                  <option key={court.id} value={court.id}>
                    {court.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              size="sm"
              onClick={handleAssign}
              disabled={!courtToAssign || createAssignment.isPending || !profile?.id}
            >
              <Plus className="h-4 w-4" />
              Assign
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Acting seating unlocks New matter on the Docket for that court. It is
            recorded on your profile like any other magistrate assignment.
          </p>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Acting</Badge>
            <Button asChild variant="ghost" size="sm" className="h-auto px-0">
              <Link to={ROUTES.adminPeople}>
                See all users
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={!!endTarget}
        onOpenChange={(open) => !open && setEndTarget(null)}
        title="End this court seating?"
        description={
          endTarget
            ? `This ends your assignment to ${endTarget.courtName}. The record is kept as history. You will not be able to add new docket matters at that court until you sit there again.`
            : undefined
        }
        confirmLabel="End assignment"
        confirmVariant="destructive"
        isConfirming={endAssignment.isPending}
        onConfirm={() => {
          if (!endTarget) return;
          const target = endTarget;
          endAssignment.mutate(target.id, {
            onSuccess: () => setEndTarget(null),
          });
        }}
      />
    </>
  );
}
