import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Pencil, Bookmark } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  DOCKET_MATTER_STATUSES,
  docketMatterOutcomeSchema,
  type DocketMatterOutcomeFormValues,
} from "@/lib/validations/docket";
import { matterCurrentStage, PROCEDURE_STAGE_LABELS, PROCEDURE_VALUE_LABELS } from "@/lib/docket-procedure";
import { formatDate, getLocalDateOnly, toTitleCase } from "@/lib/utils";
import type { DocketMatter } from "@/types/database.types";
import { useDocketMatterAccess } from "@/hooks/docket/use-docket-matter-access";
import { DocketStageStrip, type OverviewLogAppearance } from "@/pages/docket/docket-stage-strip";
import { HearingProgressSection } from "@/pages/docket/sections/hearing-progress-section";
import { DocketEventDialog } from "@/pages/docket/event-dialog";

interface OverviewSectionProps {
  matter: DocketMatter & {
    courts: { id: string; name: string; jurisdiction: string } | null;
    magisterial_districts: { id: string; name: string } | null;
  };
}

export function OverviewSection({ matter }: OverviewSectionProps) {
  const [editingOutcome, setEditingOutcome] = useState(false);
  const [retainOpen, setRetainOpen] = useState(false);
  const [retainNotes, setRetainNotes] = useState("");
  const [pendingEnd, setPendingEnd] = useState<string | null>(null);
  const [logAppearance, setLogAppearance] = useState<OverviewLogAppearance | null>(null);
  const { user } = useAuth();
  const { data: access } = useDocketMatterAccess(matter.id);
  const canEdit = access?.canEdit ?? false;
  const canManage = access?.canManage ?? false;
  const updateMatter = useUpdateDocketMatter(matter.id);
  const patchProcedure = usePatchDocketProcedure();
  const createRetained = useCreateRetainedAssignment(matter.id);
  const endRetained = useEndRetainedAssignment(matter.id);
  const { data: assignments } = useDocketAssignments(matter.id);

  const myActiveRetained = assignments?.find(
    (a) => a.profile_id === user?.id && !a.ended_at,
  );
  const anyActiveRetained = assignments?.find((a) => !a.ended_at);

  const { data: events } = useDocketEvents(matter.id);
  const nextDate = useMemo(() => {
    const today = getLocalDateOnly();
    const upcoming = (events ?? [])
      .filter((e) => e.event_status === "scheduled" && e.scheduled_date >= today)
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
    return upcoming[0]?.scheduled_date ?? null;
  }, [events]);
  const stage = matterCurrentStage(matter);

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
        orders_summary: values.orders_summary || null,
        outcome: values.outcome || null,
      });
      setEditingOutcome(false);
    } catch {
      // Surfaced globally via the mutation cache toast subscriber.
    }
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Compact status row — replaces the previous large single-value
          Status and Retained-assignments cards. Custody is shown
          read-only here (it's already editable on the Procedure board
          just below, so it isn't given a second editing surface). */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {canEdit ? (
          <Select
            value={matter.status}
            onChange={(e) =>
              updateMatter.mutate({
                status: e.target.value as (typeof DOCKET_MATTER_STATUSES)[number],
              })
            }
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
        <Badge variant="outline">{PROCEDURE_STAGE_LABELS[stage]}</Badge>
        {matter.custody_status !== "unset" && (
          <Badge variant="outline">
            {PROCEDURE_VALUE_LABELS[matter.custody_status] ?? toTitleCase(matter.custody_status)}
          </Badge>
        )}
        <Badge variant="outline">Next: {nextDate ? formatDate(nextDate) : "Not scheduled"}</Badge>

        <span className="mx-1 h-4 w-px bg-border" />

        {anyActiveRetained ? (
          <>
            <span className="text-muted-foreground">
              Retained: <span className="font-medium text-foreground">Yes — {anyActiveRetained.display_name ?? "Unknown magistrate"}</span>
            </span>
            {myActiveRetained && (
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
            {canManage && (
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setRetainOpen(true)}>
                <Bookmark className="h-3.5 w-3.5" />
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

      <DocketStageStrip
        matter={matter}
        canEdit={canEdit}
        onPatch={(values) => patchProcedure.mutateAsync({ id: matter.id, values })}
        onLogAppearance={setLogAppearance}
      />

      <HearingProgressSection matter={matter} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <CardTitle className="text-sm text-muted-foreground">Orders & outcome</CardTitle>
          {canEdit && !editingOutcome && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditingOutcome(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {editingOutcome ? (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
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
                      <FormLabel>Outcome</FormLabel>
                      <FormControl>
                        <Textarea rows={3} {...field} />
                      </FormControl>
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
                <p className="font-medium text-foreground">Orders summary</p>
                <p className="text-muted-foreground">
                  {matter.orders_summary || (
                    <span className="italic">None recorded.</span>
                  )}
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground">Outcome</p>
                <p className="text-muted-foreground">
                  {matter.outcome || <span className="italic">None recorded.</span>}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={retainOpen} onOpenChange={setRetainOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Retain this matter as part-heard</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This keeps this specific matter accessible to you even after your
            ordinary Court assignment ends, since you already heard part of
            it. You can end the retention yourself at any time.
          </p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">
              Notes (optional)
            </label>
            <Input
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
              {createRetained.isPending && (
                <LoadingSpinner className="text-current" size={16} />
              )}
              Retain matter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!pendingEnd}
        onOpenChange={(open) => !open && setPendingEnd(null)}
        title="End your retained assignment?"
        description="You will lose access to this matter unless you have another current Court assignment or an active share on it."
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
          defaults={logAppearance}
          onClose={() => setLogAppearance(null)}
        />
      )}
    </div>
  );
}
