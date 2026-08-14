import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Search, Landmark, Plus, X, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
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
import { useCourts } from "@/hooks/docket/use-lookups";
import {
  courtAssignmentKeys,
  useProfileSearch,
  useProfile,
  useProfileCourtAssignments,
  useCreateCourtAssignment,
  useEndCourtAssignment,
} from "@/hooks/admin/use-court-assignments";
import { ROLE_LABELS, type UserRole } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { BrowseHeader, BrowsePage } from "@/components/browse";

/**
 * Admin-only Court Assignment management. `magistrate_courts` is
 * AUTHORITY-ORIGINATING (a row is the sole input to `can_access_court()`,
 * itself one of the three paths feeding every Docket read/write
 * predicate), so — unlike retained/part-heard assignment, which a
 * magistrate may self-service because it can only narrow access they
 * already hold — creating, ending, or otherwise mutating a Court
 * assignment is Admin-managed only (see architecture spec §4,
 * `0052_harden_magistrate_court_assignment_authority.sql`). This screen
 * is the UX surface for that; the `magistrate_courts` RLS policies
 * themselves remain the actual, final authority regardless of what this
 * page does or doesn't show.
 *
 * Deliberately minimal: find a profile, see their current + historical
 * Court assignments, assign an active Court, end a current assignment.
 * No hard-delete of history, no bulk tools, no unrelated admin features.
 */
export default function CourtAssignmentsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [courtToAssign, setCourtToAssign] = useState("");
  const [endTarget, setEndTarget] = useState<{ id: string; courtName: string } | null>(null);

  const { data: results, isPending: searchPending } = useProfileSearch(query);
  const { data: selectedProfile, isPending: profilePending } = useProfile(
    selectedProfileId ?? undefined,
  );
  const {
    data: assignments,
    isPending: assignmentsPending,
    isError: assignmentsError,
    error: assignmentsErr,
    refetch: refetchAssignments,
  } = useProfileCourtAssignments(selectedProfileId ?? undefined);
  const { data: courts, isPending: courtsPending } = useCourts();
  const createAssignment = useCreateCourtAssignment(selectedProfileId ?? "");
  const endAssignment = useEndCourtAssignment(selectedProfileId ?? "");

  const current = assignments?.filter((a) => !a.ended_at) ?? [];
  const history = assignments?.filter((a) => a.ended_at) ?? [];
  const availableCourts = (courts ?? []).filter(
    (c) => !current.some((a) => a.court_id === c.id),
  );

  const handleSelectProfile = (id: string) => {
    const found = results?.find((p) => p.id === id);
    if (found) {
      queryClient.setQueryData(courtAssignmentKeys.profile(id), found);
    }
    setSelectedProfileId(id);
    setQuery("");
    setCourtToAssign("");
  };

  function handleAssign() {
    if (!courtToAssign) return;
    createAssignment.mutate(courtToAssign, {
      onSuccess: () => setCourtToAssign(""),
    });
  }

  return (
    <BrowsePage>
      <BrowseHeader
        title="Court Assignments"
        description="A Court assignment originates ordinary Docket authority, so it's admin-managed only. Find a profile, then assign or end a Court assignment. Ending never deletes history."
      />

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Find a profile</CardTitle>
            <CardDescription>Search by name or email.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Full name or email…"
                className="pl-8"
                aria-label="Search profiles"
              />
            </div>

            {query.trim().length > 0 && query.trim().length < 2 && (
              <p className="px-1 text-xs text-muted-foreground">Keep typing…</p>
            )}

            {query.trim().length >= 2 &&
              (searchPending ? (
                <Skeleton className="h-16 w-full" />
              ) : !results || results.length === 0 ? (
                <p className="px-1 py-2 text-sm text-muted-foreground">
                  No matching profiles.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {results.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectProfile(p.id)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">
                            {p.full_name ?? "(no name)"}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {p.email}
                          </span>
                        </span>
                        {!p.is_active && (
                          <Badge variant="outline" className="shrink-0">
                            Inactive
                          </Badge>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </CardContent>
        </Card>

        {!selectedProfileId ? (
          <Card>
            <CardContent className="p-6">
              <EmptyState
                icon={ShieldCheck}
                title="No profile selected"
                description="Search for a profile by name or email to view or manage its Court assignments."
              />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div className="min-w-0">
                  {profilePending && !selectedProfile ? (
                    <>
                      <Skeleton className="h-5 w-48" />
                      <Skeleton className="mt-2 h-4 w-56" />
                    </>
                  ) : (
                    <>
                      <CardTitle className="truncate text-base">
                        {selectedProfile?.full_name ?? "(no name)"}
                      </CardTitle>
                      <CardDescription className="truncate">
                        {selectedProfile?.email}
                      </CardDescription>
                    </>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {selectedProfile && (
                    <>
                      <Badge variant="outline">
                        {ROLE_LABELS[selectedProfile.role as UserRole] ?? selectedProfile.role}
                      </Badge>
                      <Badge variant={selectedProfile.is_active ? "default" : "outline"}>
                        {selectedProfile.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSelectedProfileId(null)}
                    aria-label="Clear selected profile"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Landmark className="h-4 w-4" />
                  Current Court assignments
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {assignmentsPending ? (
                  <Skeleton className="h-10 w-full" />
                ) : assignmentsError ? (
                  <InlineError error={assignmentsErr} onRetry={() => void refetchAssignments()} />
                ) : current.length === 0 ? (
                  <EmptyState
                    title="No current Court assignment"
                    description="This profile is not currently assigned to a Court."
                  />
                ) : (
                  <ul className="divide-y divide-border">
                    {current.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {a.courts?.name ?? "Unknown court"}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {a.courts?.jurisdiction} · Since {formatDate(a.started_at)}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setEndTarget({ id: a.id, courtName: a.courts?.name ?? "this Court" })
                          }
                        >
                          End assignment
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                {selectedProfile && !selectedProfile.is_active && (
                  <p className="text-xs text-muted-foreground">
                    This profile is inactive. New assignments should generally be limited to
                    active profiles.
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <Select
                    value={courtToAssign}
                    onChange={(e) => setCourtToAssign(e.target.value)}
                    disabled={courtsPending || availableCourts.length === 0}
                    aria-label="Court to assign"
                    className="max-w-xs"
                  >
                    <option value="">
                      {!courtsPending && availableCourts.length === 0
                        ? "No further active Courts"
                        : "Select a Court…"}
                    </option>
                    {availableCourts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    onClick={handleAssign}
                    disabled={!courtToAssign || createAssignment.isPending}
                  >
                    <Plus className="h-4 w-4" />
                    Assign
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">History</CardTitle>
                <CardDescription>Ended Court assignments — preserved, never deleted.</CardDescription>
              </CardHeader>
              <CardContent>
                {assignmentsPending ? (
                  <Skeleton className="h-10 w-full" />
                ) : history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No ended assignments.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {history.map((a) => (
                      <li key={a.id} className="py-2 text-sm">
                        <p className="font-medium text-foreground">
                          {a.courts?.name ?? "Unknown court"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(a.started_at)} – {a.ended_at ? formatDate(a.ended_at) : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <AlertDialog
        open={!!endTarget}
        onOpenChange={(open) => !open && setEndTarget(null)}
        title="End Court assignment?"
        description={
          endTarget
            ? `This ends the current assignment to ${endTarget.courtName}. The record is preserved as history, not deleted, and this profile can be re-assigned later if needed.`
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
    </BrowsePage>
  );
}
