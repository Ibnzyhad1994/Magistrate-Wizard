import { useMemo, useState } from "react";
import { ArrowRightLeft, Landmark, Plus, X } from "lucide-react";
import { OccupiedCourtResolutionFields } from "@/components/admin/occupied-court-resolution-fields";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { AdminPersonRow } from "@/hooks/admin/use-admin-people";
import {
  useCreateCourtAssignment,
  useEndCourtAssignment,
  useOccupiedPrimaryCourtIds,
  useTransferCourtAssignment,
  type CourtAssignmentType,
  type OccupiedIfNeeded,
} from "@/hooks/admin/use-court-assignments";
import { useCourts } from "@/hooks/docket/use-lookups";
import { ASSIGNMENT_TYPE_LABEL } from "@/lib/court-assignment-roster";
import { ROLE_LABELS } from "@/lib/constants";
import type { OccupiedCourtResolution } from "@/lib/occupied-court-exception";
import { useRevokeClerkCourtAccess } from "@/hooks/clerk/use-clerk-access-review";

export function PeopleCourtSheet(props: { person: AdminPersonRow | null; onClose: () => void }) {
  const person = props.person;
  const magistrateCourts = (person?.courts ?? []).filter((court) => court.kind === "magistrate");
  const clerkCourts = (person?.courts ?? []).filter((court) => court.kind === "clerk");
  const { data: courts } = useCourts();
  const { data: occupiedIds } = useOccupiedPrimaryCourtIds();
  const createAssignment = useCreateCourtAssignment(person?.id ?? "");
  const endAssignment = useEndCourtAssignment(person?.id ?? "");
  const transferAssignment = useTransferCourtAssignment(person?.id ?? "");
  const revokeClerk = useRevokeClerkCourtAccess();

  const sittingCourtIds = new Set(magistrateCourts.map((court) => court.courtId));
  const assignableCourts = (courts ?? []).filter((court) => !sittingCourtIds.has(court.id));

  const [courtToAssign, setCourtToAssign] = useState("");
  const [assignmentType, setAssignmentType] = useState<CourtAssignmentType>("regular");
  const [assignResolution, setAssignResolution] = useState<OccupiedCourtResolution | "">("");
  const [assignReason, setAssignReason] = useState("");
  const [endTarget, setEndTarget] = useState<{
    id: string;
    courtName: string;
    kind: "magistrate" | "clerk";
  } | null>(null);
  const [transferFromId, setTransferFromId] = useState("");
  const [transferToId, setTransferToId] = useState("");
  const [transferResolution, setTransferResolution] = useState<OccupiedCourtResolution | "">("");
  const [transferReason, setTransferReason] = useState("");

  const assignOccupied =
    assignmentType === "regular" &&
    Boolean(courtToAssign) &&
    Boolean(occupiedIds?.has(courtToAssign));
  const transferFrom = magistrateCourts.find((court) => court.assignmentId === transferFromId);
  const transferOccupied =
    Boolean(transferToId) &&
    Boolean(occupiedIds?.has(transferToId)) &&
    (transferFrom?.assignmentType ?? "regular") === "regular";

  const canManageMagistrate = person?.role === "magistrate" || person?.role === "admin";
  const canManageClerk = person?.role === "clerk";

  const neverSignedIn = person != null && person.lastLoginAt == null;

  const transferDestinations = useMemo(
    () => (courts ?? []).filter((court) => court.id !== transferFrom?.courtId),
    [courts, transferFrom?.courtId],
  );

  function resetAssign() {
    setCourtToAssign("");
    setAssignmentType("regular");
    setAssignResolution("");
    setAssignReason("");
  }

  function resetTransfer() {
    setTransferFromId("");
    setTransferToId("");
    setTransferResolution("");
    setTransferReason("");
  }

  return (
    <Sheet open={!!person} onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Court assignments</SheetTitle>
          <SheetDescription>
            {person?.fullName || "Unnamed"} · {person ? ROLE_LABELS[person.role] : ""}
          </SheetDescription>
        </SheetHeader>

        {!person ? null : (
          <div className="mt-6 space-y-8">
            {canManageClerk && (
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Landmark className="h-4 w-4" />
                  Clerk courts
                </h3>
                {clerkCourts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No current clerk sitting. Approve a Clerk Access request to seat them.
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {clerkCourts.map((court) => (
                      <li
                        key={court.assignmentId ?? court.courtId}
                        className="flex items-start justify-between gap-2 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {court.courtName}
                          </p>
                          <p className="text-xs text-muted-foreground">Clerk</p>
                        </div>
                        {court.assignmentId && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setEndTarget({
                                id: court.assignmentId!,
                                courtName: court.courtName,
                                kind: "clerk",
                              })
                            }
                          >
                            End
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {canManageMagistrate && (
              <>
                {neverSignedIn && (
                  <p className="rounded-sm border border-border bg-foreground/5 px-3 py-2 text-xs text-muted-foreground">
                    This person has not signed in yet, so they do not occupy a court slot and will
                    not appear as blocking that court for someone else.
                  </p>
                )}

                <section className="space-y-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Landmark className="h-4 w-4" />
                    Current courts
                  </h3>
                  {magistrateCourts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No current magistrate sitting.</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {magistrateCourts.map((court) => {
                        const typeLabel = court.assignmentType
                          ? (ASSIGNMENT_TYPE_LABEL[court.assignmentType] ?? court.assignmentType)
                          : "Primary";
                        return (
                          <li
                            key={`${court.courtId}:${court.assignmentType ?? "regular"}`}
                            className="flex items-start justify-between gap-2 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">
                                {court.courtName}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {typeLabel}
                                {court.occupiesPrimarySlot === false &&
                                court.assignmentType === "regular"
                                  ? " · does not occupy this court yet"
                                  : ""}
                              </p>
                            </div>
                            {court.assignmentId && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setEndTarget({
                                    id: court.assignmentId!,
                                    courtName: court.courtName,
                                    kind: "magistrate",
                                  })
                                }
                              >
                                End
                              </Button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                <section className="space-y-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Plus className="h-4 w-4" />
                    Assign a court
                  </h3>
                  <div className="space-y-1.5">
                    <Label htmlFor="people-assign-court">Court</Label>
                    <Select
                      id="people-assign-court"
                      value={courtToAssign}
                      onChange={(e) => {
                        setCourtToAssign(e.target.value);
                        setAssignResolution("");
                      }}
                    >
                      <option value="">
                        {assignableCourts.length === 0
                          ? "No further active courts"
                          : "Select a court…"}
                      </option>
                      {assignableCourts.map((court) => (
                        <option key={court.id} value={court.id}>
                          {court.name}
                          {occupiedIds?.has(court.id) ? " (occupied)" : ""}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="people-assign-type">Sitting</Label>
                    <Select
                      id="people-assign-type"
                      value={assignmentType}
                      onChange={(e) => {
                        setAssignmentType(e.target.value as CourtAssignmentType);
                        setAssignResolution("");
                      }}
                    >
                      {(["regular", "acting", "relief"] as const).map((type) => (
                        <option key={type} value={type}>
                          {ASSIGNMENT_TYPE_LABEL[type]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {assignOccupied && (
                    <OccupiedCourtResolutionFields
                      name="people-assign-resolution"
                      value={assignResolution}
                      onChange={setAssignResolution}
                    />
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="people-assign-reason">Reason (optional)</Label>
                    <Textarea
                      id="people-assign-reason"
                      value={assignReason}
                      onChange={(e) => setAssignReason(e.target.value)}
                      placeholder="Recorded on the assignment if you replace or transfer"
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={
                      !courtToAssign ||
                      createAssignment.isPending ||
                      (assignOccupied && !assignResolution)
                    }
                    onClick={() => {
                      if (!courtToAssign) return;
                      createAssignment.mutate(
                        {
                          courtId: courtToAssign,
                          assignmentType,
                          ifOccupied: assignOccupied
                            ? (assignResolution as OccupiedIfNeeded)
                            : undefined,
                          reason: assignReason.trim() || undefined,
                        },
                        { onSuccess: resetAssign },
                      );
                    }}
                  >
                    Assign
                  </Button>
                </section>

                <section className="space-y-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <ArrowRightLeft className="h-4 w-4" />
                    Transfer to another court
                  </h3>
                  {magistrateCourts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Assign a court first, then you can transfer this magistrate.
                    </p>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="people-transfer-from">From</Label>
                        <Select
                          id="people-transfer-from"
                          value={transferFromId}
                          onChange={(e) => {
                            setTransferFromId(e.target.value);
                            setTransferToId("");
                            setTransferResolution("");
                          }}
                        >
                          <option value="">Select current sitting…</option>
                          {magistrateCourts.map((court) =>
                            court.assignmentId ? (
                              <option key={court.assignmentId} value={court.assignmentId}>
                                {court.courtName}
                              </option>
                            ) : null,
                          )}
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="people-transfer-to">To</Label>
                        <Select
                          id="people-transfer-to"
                          value={transferToId}
                          disabled={!transferFromId}
                          onChange={(e) => {
                            setTransferToId(e.target.value);
                            setTransferResolution("");
                          }}
                        >
                          <option value="">
                            {!transferFromId
                              ? "Select a current sitting first"
                              : "Select destination…"}
                          </option>
                          {transferDestinations.map((court) => (
                            <option key={court.id} value={court.id}>
                              {court.name}
                              {occupiedIds?.has(court.id) ? " (occupied)" : ""}
                            </option>
                          ))}
                        </Select>
                      </div>
                      {transferOccupied && (
                        <OccupiedCourtResolutionFields
                          name="people-transfer-resolution"
                          value={transferResolution}
                          onChange={setTransferResolution}
                          legend="The destination court already has a signed-in primary magistrate."
                        />
                      )}
                      <div className="space-y-1.5">
                        <Label htmlFor="people-transfer-reason">Reason (optional)</Label>
                        <Textarea
                          id="people-transfer-reason"
                          value={transferReason}
                          onChange={(e) => setTransferReason(e.target.value)}
                        />
                      </div>
                      <Button
                        size="sm"
                        disabled={
                          !transferFromId ||
                          !transferToId ||
                          transferAssignment.isPending ||
                          (transferOccupied && !transferResolution)
                        }
                        onClick={() => {
                          if (!transferFromId || !transferToId) return;
                          transferAssignment.mutate(
                            {
                              assignmentId: transferFromId,
                              newCourtId: transferToId,
                              ifOccupied: transferOccupied
                                ? (transferResolution as OccupiedIfNeeded)
                                : undefined,
                              reason: transferReason.trim() || undefined,
                            },
                            { onSuccess: resetTransfer },
                          );
                        }}
                      >
                        Transfer
                      </Button>
                    </>
                  )}
                </section>
              </>
            )}
          </div>
        )}

        <Button variant="ghost" className="mt-8 self-start" onClick={props.onClose}>
          <X className="h-4 w-4" />
          Close
        </Button>
      </SheetContent>

      <AlertDialog
        open={!!endTarget}
        onOpenChange={(open) => !open && setEndTarget(null)}
        title="End this court assignment?"
        description={
          endTarget
            ? `This ends the current assignment to ${endTarget.courtName}. The record is kept as history.`
            : undefined
        }
        confirmLabel="End assignment"
        confirmVariant="destructive"
        isConfirming={endAssignment.isPending || revokeClerk.isPending}
        onConfirm={() => {
          if (!endTarget) return;
          if (endTarget.kind === "clerk") {
            revokeClerk.mutate(
              { assignmentId: endTarget.id },
              { onSuccess: () => setEndTarget(null) },
            );
            return;
          }
          endAssignment.mutate(endTarget.id, { onSuccess: () => setEndTarget(null) });
        }}
      />
    </Sheet>
  );
}
