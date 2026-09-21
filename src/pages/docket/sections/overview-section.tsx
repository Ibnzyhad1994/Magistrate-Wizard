import { useId, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Pencil, Pin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import { useUpdateDocketMatter, usePatchDocketProcedure } from "@/hooks/docket/use-docket-matters";
import {
  useCreateRetainedAssignment,
  useDocketAssignments,
  useEndRetainedAssignment,
} from "@/hooks/docket/use-docket-assignments";
import { useDocketEvents } from "@/hooks/docket/use-docket-events";
import { useDocketMatterCategories } from "@/hooks/docket/use-docket-capacity";
import {
  DOCKET_MATTER_STATUSES,
  OTHER_MATTER_CATEGORY_NAME,
  docketMatterClassificationSchemaForCategories,
  docketMatterOutcomeSchema,
  matterClassificationLabel,
  type DocketMatterClassificationFormValues,
  type DocketMatterOutcomeFormValues,
} from "@/lib/validations/docket";
import { PROCEDURE_VALUE_LABELS, procedureStageLabel } from "@/lib/docket-procedure";
import { outcomeLabel } from "@/lib/docket-outcome";
import {
  matterProtocol,
  matterProtocolStage,
  outcomeBoardPatch,
  protocolFromCategoryName,
  protocolLabel,
} from "@/lib/docket-protocols";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate, getLocalDateOnly, toTitleCase } from "@/lib/utils";
import { isConcurrentEditError } from "@/lib/concurrency";
import type { DocketMatter } from "@/types";
import { useDocketMatterAccess } from "@/hooks/docket/use-docket-matter-access";
import { DocketStageStrip, type OverviewLogAppearance } from "@/pages/docket/docket-stage-strip";
import { HearingProgressSection } from "@/pages/docket/sections/hearing-progress-section";
import { DocketEventDialog } from "@/pages/docket/event-dialog";
import { NextDateDialog } from "@/pages/docket/next-date-cell";

type MatterStatus = (typeof DOCKET_MATTER_STATUSES)[number];

interface OverviewSectionProps {
  matter: DocketMatter & {
    courts: { id: string; name: string; jurisdiction: string } | null;
    magisterial_districts: { id: string; name: string } | null;
  };
}

export function OverviewSection({ matter }: OverviewSectionProps) {
  const [editingOutcome, setEditingOutcome] = useState(false);
  const [editingClassification, setEditingClassification] = useState(false);
  const [retainOpen, setRetainOpen] = useState(false);
  const [retainNotes, setRetainNotes] = useState("");
  const retainNotesId = useId();
  const [pendingEnd, setPendingEnd] = useState<string | null>(null);
  const [logAppearance, setLogAppearance] = useState<OverviewLogAppearance | null>(null);
  const [nextDateOpen, setNextDateOpen] = useState(false);
  const { user } = useAuth();
  const { data: access } = useDocketMatterAccess(matter.id);
  const canEdit = access?.canEdit ?? false;
  const canManage = access?.canManage ?? false;
  const isBinned = Boolean(matter.deleted_at);
  const liveEdit = canEdit && !isBinned;
  const liveManage = canManage && !isBinned;
  const updateMatter = useUpdateDocketMatter(matter.id);
  const patchProcedure = usePatchDocketProcedure();
  const createRetained = useCreateRetainedAssignment(matter.id);
  const endRetained = useEndRetainedAssignment(matter.id);
  const { data: assignments } = useDocketAssignments(matter.id);

  const myActiveRetained = assignments?.find((a) => a.profile_id === user?.id && !a.ended_at);
  const anyActiveRetained = assignments?.find((a) => !a.ended_at);

  // Completed / Archived end every retained assignment on the matter by
  // trigger (0022 §7) and reopening does not restore them, so the change
  // is confirmed first. Reopening from a closed state offers to clear the
  // board outcome: outcome -> status is one-way (0131), so a matter left
  // with outcome_status set but status Active reads as contradictory.
  const [pendingStatus, setPendingStatus] = useState<MatterStatus | null>(null);
  const [clearOutcomeOnReopen, setClearOutcomeOnReopen] = useState(true);
  const clearOutcomeId = useId();
  const isClosedStatus = (s: string) => s === "completed" || s === "archived";
  const visibleActiveRetained = (assignments ?? []).filter((a) => !a.ended_at);

  function applyStatus(next: MatterStatus, clearOutcome = false) {
    updateMatter.mutate(
      {
        values: clearOutcome ? { status: next, outcome_status: null } : { status: next },
        expectedUpdatedAt: matter.updated_at,
      },
      { onSuccess: () => setPendingStatus(null) },
    );
  }

  function requestStatusChange(next: MatterStatus) {
    if (next === matter.status) return;
    const closing = isClosedStatus(next) && !isClosedStatus(matter.status);
    const reopening = next === "active" && isClosedStatus(matter.status) && !!matter.outcome_status;
    if (closing || reopening) {
      setClearOutcomeOnReopen(true);
      setPendingStatus(next);
      return;
    }
    applyStatus(next);
  }

  const { data: events } = useDocketEvents(matter.id);
  const { data: categories } = useDocketMatterCategories();
  const categoryName = categories?.find((c) => c.id === matter.category_id)?.name;
  const classificationLabel = matterClassificationLabel(categoryName, matter.category_other);
  const nextDate = useMemo(() => {
    const today = getLocalDateOnly();
    const upcoming = (events ?? [])
      .filter((e) => e.event_status === "scheduled" && e.scheduled_date >= today)
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
    return upcoming[0]?.scheduled_date ?? null;
  }, [events]);
  const protocol = matterProtocol({
    workflow_protocol: matter.workflow_protocol,
    category_name: categoryName,
  });
  const stage = matterProtocolStage({
    ...matter,
    category_name: categoryName,
  });
  // The protocol walk (currentStageForProtocol) lands on its terminal
  // stage -- appeal for the criminal boards, decision for civil -- only
  // once every earlier stage is done. A matter sitting there with no board
  // outcome stays Active forever unless someone notices.
  const boardComplete =
    (stage === "appeal" || stage === "decision") &&
    !matter.outcome_status &&
    !isClosedStatus(matter.status);

  const form = useForm<DocketMatterOutcomeFormValues>({
    resolver: zodResolver(docketMatterOutcomeSchema),
    defaultValues: {
      orders_summary: matter.orders_summary ?? "",
      outcome: matter.outcome ?? "",
    },
  });

  async function onSubmit(values: DocketMatterOutcomeFormValues) {
    try {
      await updateMatter.mutateAsync({
        values: {
          orders_summary: values.orders_summary || null,
          outcome: values.outcome || null,
        },
        expectedUpdatedAt: matter.updated_at,
      });
      setEditingOutcome(false);
    } catch (err) {
      // The conflict message itself is surfaced globally via the mutation
      // cache toast subscriber (concurrency.ts's message). Closing the
      // form here (instead of leaving the user's stale edits on screen)
      // is what actually satisfies "review the latest information before
      // saving" -- the matter prop refetches in the background (see
      // useUpdateDocketMatter's onError) and the read-only view below
      // will show the current, correct data the moment it lands.
      if (isConcurrentEditError(err)) {
        setEditingOutcome(false);
      }
    }
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Compact status row — replaces the previous large single-value
          Status and Retained-assignments cards. Custody is shown
          read-only here (it's already editable on the Procedure board
          just below, so it isn't given a second editing surface). */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {liveEdit ? (
          <Select
            value={matter.status}
            onChange={(e) => requestStatusChange(e.target.value as MatterStatus)}
            disabled={updateMatter.isPending}
            aria-label="Matter status"
            className="h-8 w-auto py-0 text-xs"
          >
            {DOCKET_MATTER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {toTitleCase(s)}
              </option>
            ))}
          </Select>
        ) : (
          <Badge>{toTitleCase(matter.status)}</Badge>
        )}
        <Badge variant="outline">{procedureStageLabel(stage)}</Badge>
        {protocol !== "civil_summons" && matter.custody_status !== "unset" && (
          <Badge variant="outline">
            {PROCEDURE_VALUE_LABELS[matter.custody_status] ?? toTitleCase(matter.custody_status)}
          </Badge>
        )}
        {liveEdit ? (
          <button
            type="button"
            onClick={() => setNextDateOpen(true)}
            className="rounded-full"
            aria-label={
              nextDate ? `Change next date, currently ${formatDate(nextDate)}` : "Set next date"
            }
          >
            <Badge variant="outline">
              Next: {nextDate ? formatDate(nextDate) : "Not scheduled"}
            </Badge>
          </button>
        ) : (
          <Badge variant="outline">Next: {nextDate ? formatDate(nextDate) : "Not scheduled"}</Badge>
        )}
        <Badge variant="outline">{classificationLabel ?? "Unclassified"}</Badge>
        {liveEdit && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => setEditingClassification(true)}
            aria-label="Edit classification"
          >
            <Pencil className="h-3.5 w-3.5" />
            Classification
          </Button>
        )}

        <span className="mx-1 h-4 w-px bg-border" />

        {anyActiveRetained ? (
          <>
            <span className="text-muted-foreground">
              Retained:{" "}
              <span className="font-medium text-foreground">
                Yes ({anyActiveRetained.display_name ?? "Unknown magistrate"})
              </span>
            </span>
            {myActiveRetained && liveManage && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-destructive hover:text-destructive"
                onClick={() => setPendingEnd(myActiveRetained.id)}
              >
                End my retention
              </Button>
            )}
          </>
        ) : (
          <>
            <span className="text-muted-foreground">Retained: No</span>
            {liveManage && (
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setRetainOpen(true)}>
                <Pin className="h-3.5 w-3.5" />
                Retain as part-heard
              </Button>
            )}
          </>
        )}
      </div>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm text-muted-foreground">Charge / issue</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-sm text-foreground">
          {matter.charge_or_issue || (
            <span className="italic text-muted-foreground">No charge or issue recorded.</span>
          )}
        </CardContent>
      </Card>

      {boardComplete && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[hsl(var(--notice-action)/0.35)] bg-[hsl(var(--notice-action)/0.08)] px-3 py-2 text-sm"
        >
          <p className="text-foreground">
            <span className="font-medium">Board complete.</span> Every stage is done, but
            there&apos;s no outcome yet, so this matter is still active.
          </p>
          {liveEdit && (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={patchProcedure.isPending}
                onClick={() =>
                  void patchProcedure.mutateAsync({
                    id: matter.id,
                    values: outcomeBoardPatch("completed"),
                    expectedUpdatedAt: matter.updated_at,
                  })
                }
              >
                Mark completed
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                disabled={patchProcedure.isPending}
                onClick={() =>
                  void patchProcedure.mutateAsync({
                    id: matter.id,
                    values: outcomeBoardPatch("dismissed"),
                    expectedUpdatedAt: matter.updated_at,
                  })
                }
              >
                Mark dismissed
              </Button>
            </div>
          )}
        </div>
      )}

      <DocketStageStrip
        matter={matter}
        canEdit={liveEdit}
        categoryName={categoryName}
        onPatch={(values, expectedUpdatedAt) =>
          patchProcedure.mutateAsync({ id: matter.id, values, expectedUpdatedAt })
        }
        onLogAppearance={setLogAppearance}
      />

      <HearingProgressSection matter={matter} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <CardTitle className="text-sm text-muted-foreground">Orders & outcome</CardTitle>
          {liveEdit && !editingOutcome && (
            <Button size="sm" variant="ghost" onClick={() => setEditingOutcome(true)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {editingOutcome ? (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="orders_summary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Orders summary</FormLabel>
                      <FormControl>
                        <Textarea rows={3} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="outcome"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Outcome notes</FormLabel>
                      <FormControl>
                        <Textarea rows={3} {...field} />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        Set the outcome in Procedure above. Use these notes for anything extra.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingOutcome(false)}
                    disabled={updateMatter.isPending}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={updateMatter.isPending}>
                    {updateMatter.isPending && (
                      <LoadingSpinner className="text-current" size={14} />
                    )}
                    Save
                  </Button>
                </div>
              </form>
            </Form>
          ) : (
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-medium text-foreground">Board outcome</p>
                <p className="text-muted-foreground">
                  {outcomeLabel(matter.outcome_status, matter.outcome_adjourned)}
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground">Orders summary</p>
                <p className="text-muted-foreground">
                  {matter.orders_summary || <span className="italic">None recorded.</span>}
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground">Outcome notes</p>
                <p className="text-muted-foreground">
                  {matter.outcome || <span className="italic">None recorded.</span>}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={retainOpen} onOpenChange={setRetainOpen}>
        <DialogContent preventDismissWhenDirty={form.formState.isDirty} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Retain this matter as part-heard</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Keep access to this part-heard matter after you leave this court. You can stop at any
            time.
          </p>
          <div className="space-y-1.5">
            <label htmlFor={retainNotesId} className="text-sm font-medium text-foreground">
              Notes (optional)
            </label>
            <Input
              id={retainNotesId}
              value={retainNotes}
              onChange={(e) => setRetainNotes(e.target.value)}
              placeholder="e.g. part-heard on evidence, adjourned for judgment"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRetainOpen(false)}
              disabled={createRetained.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() =>
                createRetained.mutate(retainNotes, {
                  onSuccess: () => {
                    setRetainOpen(false);
                    setRetainNotes("");
                  },
                })
              }
              disabled={createRetained.isPending}
            >
              {createRetained.isPending && <LoadingSpinner className="text-current" size={16} />}
              Retain matter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editingClassification && (
        <ClassificationDialog
          matter={matter}
          canEdit={liveEdit}
          onClose={() => setEditingClassification(false)}
        />
      )}

      <AlertDialog
        open={!!pendingStatus}
        onOpenChange={(open) => !open && setPendingStatus(null)}
        title={
          pendingStatus && isClosedStatus(pendingStatus)
            ? `Mark this matter ${toTitleCase(pendingStatus)}?`
            : "Reopen this matter?"
        }
        confirmLabel={
          pendingStatus && isClosedStatus(pendingStatus)
            ? `Mark ${toTitleCase(pendingStatus)}`
            : "Reopen"
        }
        confirmVariant={pendingStatus && isClosedStatus(pendingStatus) ? "destructive" : "default"}
        isConfirming={updateMatter.isPending}
        description={
          pendingStatus && isClosedStatus(pendingStatus) ? (
            <div className="space-y-2">
              <p>
                All part-heard retentions on this matter end now. Reopening it won&apos;t restore
                them.
              </p>
              {visibleActiveRetained.length > 0 ? (
                <ul className="list-disc pl-5 text-foreground">
                  {visibleActiveRetained.map((a) => (
                    <li key={a.id}>
                      {a.display_name ?? "Unknown magistrate"}
                      {a.profile_id === user?.id ? " (you)" : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>You haven&apos;t retained this matter. Anyone else&apos;s retention ends too.</p>
              )}
            </div>
          ) : pendingStatus ? (
            <div className="space-y-2">
              <p>
                The board outcome is still{" "}
                <span className="font-medium text-foreground">
                  {outcomeLabel(matter.outcome_status, matter.outcome_adjourned)}
                </span>
                . An active matter shouldn&apos;t have an outcome.
              </p>
              <label
                htmlFor={clearOutcomeId}
                className="flex cursor-pointer items-center gap-2 text-foreground"
              >
                <Checkbox
                  id={clearOutcomeId}
                  checked={clearOutcomeOnReopen}
                  onCheckedChange={(checked) => setClearOutcomeOnReopen(checked === true)}
                />
                Also clear the board outcome
              </label>
            </div>
          ) : undefined
        }
        onConfirm={() => {
          if (!pendingStatus) return;
          applyStatus(pendingStatus, pendingStatus === "active" && clearOutcomeOnReopen);
        }}
      />
      <AlertDialog
        open={!!pendingEnd}
        onOpenChange={(open) => !open && setPendingEnd(null)}
        title="End your retained assignment?"
        description="You'll lose access unless you sit this court or it's shared with you."
        confirmLabel="End retention"
        isConfirming={endRetained.isPending}
        onConfirm={() => {
          if (pendingEnd) {
            endRetained.mutate(pendingEnd, {
              onSuccess: () => setPendingEnd(null),
            });
          }
        }}
      />
      {logAppearance && (
        <DocketEventDialog
          matterId={matter.id}
          event={null}
          defaults={{ ...logAppearance, category_id: matter.category_id ?? "" }}
          onClose={() => setLogAppearance(null)}
        />
      )}
      {nextDateOpen && (
        <NextDateDialog
          matterId={matter.id}
          currentDate={nextDate}
          matterCategoryId={matter.category_id ?? null}
          onClose={() => setNextDateOpen(false)}
        />
      )}
    </div>
  );
}

function ClassificationDialog({
  matter,
  canEdit,
  onClose,
}: {
  matter: DocketMatter;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { data: categories } = useDocketMatterCategories();
  const updateMatter = useUpdateDocketMatter(matter.id);
  const otherCategoryId = categories?.find((c) => c.name === OTHER_MATTER_CATEGORY_NAME)?.id;
  const schema = useMemo(
    () => docketMatterClassificationSchemaForCategories(otherCategoryId),
    [otherCategoryId],
  );
  const form = useForm<DocketMatterClassificationFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      category_id: matter.category_id ?? "",
      category_other: matter.category_other ?? "",
    },
  });
  const watchedCategoryId = form.watch("category_id");
  const isOther = !!otherCategoryId && watchedCategoryId === otherCategoryId;

  // Classification silently selects which of the three boards this matter
  // uses: a trigger (0140) recomputes workflow_protocol and procedure_stage
  // on every update. Reclassifying a matter that has reached Sentence sends
  // it back to the first stage of the new board with the old columns
  // showing N/A -- which is indistinguishable, on screen, from having lost
  // the work. It is actually recoverable (the trigger only reassigns those
  // two fields; the other columns keep their values and reappear if you
  // switch back), but nothing said so. Warn at the point of decision, and
  // only when the board would genuinely change -- correcting "Liability" to
  // "Maintenance" stays on the civil board and needs no warning.
  const currentProtocol = matterProtocol(matter);
  const nextProtocol = protocolFromCategoryName(
    (categories ?? []).find((c) => c.id === watchedCategoryId)?.name,
  );
  const protocolWillChange = Boolean(watchedCategoryId) && nextProtocol !== currentProtocol;

  async function handleSubmit(values: DocketMatterClassificationFormValues) {
    if (
      otherCategoryId &&
      values.category_id === otherCategoryId &&
      !values.category_other?.trim()
    ) {
      form.setError("category_other", { type: "manual", message: "Describe the matter type" });
      return;
    }
    try {
      await updateMatter.mutateAsync({
        values: {
          category_id: values.category_id,
          category_other:
            otherCategoryId && values.category_id === otherCategoryId
              ? values.category_other?.trim() || null
              : null,
        },
        expectedUpdatedAt: matter.updated_at,
      });
      onClose();
    } catch (err) {
      if (isConcurrentEditError(err)) onClose();
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent preventDismissWhenDirty={form.formState.isDirty} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Matter classification</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="category_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Classification</FormLabel>
                  <FormControl>
                    <Select
                      {...field}
                      disabled={!canEdit}
                      onChange={(e) => {
                        field.onChange(e);
                        if (e.target.value !== otherCategoryId) {
                          form.setValue("category_other", "");
                        }
                      }}
                      aria-label="Matter classification"
                    >
                      <option value="">Select a classification…</option>
                      {(categories ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {isOther && (
              <FormField
                control={form.control}
                name="category_other"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type of matter</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Describe the matter type"
                        {...field}
                        disabled={!canEdit}
                        aria-label="Type of matter"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {protocolWillChange && (
              <div
                role="status"
                className="rounded-sm border border-stage-progress/40 bg-stage-progress/10 px-3 py-2 text-xs leading-relaxed text-foreground"
              >
                <p className="font-semibold">
                  This moves the matter from the {protocolLabel(currentProtocol)} board to the{" "}
                  {protocolLabel(nextProtocol)} board.
                </p>
                <p className="mt-1 text-muted-foreground">
                  The stage is worked out again for the new board, so it may look like it went back.
                  Nothing is deleted: switch back and the old stages return.
                </p>
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={updateMatter.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateMatter.isPending || !canEdit}>
                {updateMatter.isPending && <LoadingSpinner className="text-current" size={16} />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
