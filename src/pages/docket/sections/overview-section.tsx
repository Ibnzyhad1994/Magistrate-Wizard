import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Pencil, Bookmark } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/common/inline-error";
import { EmptyState } from "@/components/common/empty-state";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import { useUpdateDocketMatter } from "@/hooks/docket/use-docket-matters";
import {
  useCreateRetainedAssignment,
  useDocketAssignments,
  useEndRetainedAssignment,
} from "@/hooks/docket/use-docket-assignments";
import {
  DOCKET_MATTER_STATUSES,
  docketMatterOutcomeSchema,
  type DocketMatterOutcomeFormValues,
} from "@/lib/validations/docket";
import { formatDateTime, toTitleCase } from "@/lib/utils";
import type { DocketMatter } from "@/types/database.types";
import { IdentificationImageControl } from "@/components/common/identification-image-control";
import {
  useClearMatterCover,
  useSetMatterCover,
} from "@/hooks/docket/use-identification-images";
import { useDocketMatterAccess } from "@/hooks/docket/use-docket-matter-access";

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
  const { user } = useAuth();
  const { data: access } = useDocketMatterAccess(matter.id);
  const canEdit = access?.canEdit ?? false;
  const canManage = access?.canManage ?? false;
  const updateMatter = useUpdateDocketMatter(matter.id);
  const setCover = useSetMatterCover(matter.id);
  const clearCover = useClearMatterCover(matter.id);
  const createRetained = useCreateRetainedAssignment(matter.id);
  const endRetained = useEndRetainedAssignment(matter.id);
  const {
    data: assignments,
    isPending: assignmentsPending,
    isError: assignmentsError,
    error: assignmentsErr,
  } = useDocketAssignments(matter.id);

  const myActiveRetained = assignments?.find(
    (a) => a.profile_id === user?.id && !a.ended_at,
  );

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
    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Charge / issue</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {matter.charge_or_issue || (
            <span className="italic">No charge or issue recorded.</span>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">Cover / identification</CardTitle>
        </CardHeader>
        <CardContent>
          <IdentificationImageControl
            path={matter.cover_image_path}
            alt={`Cover for ${matter.matter_title}`}
            label="Matter cover"
            description="Shown on the Docket browse tile and title billboard. JPEG, PNG, or WebP, up to 5 MB."
            isPending={setCover.isPending || clearCover.isPending}
            onUpload={(file) => setCover.mutate(file)}
            onClear={() => clearCover.mutate()}
            readOnly={!canEdit}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent>
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
            >
              {DOCKET_MATTER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {toTitleCase(s)}
                </option>
              ))}
            </Select>
          ) : (
            <p className="text-sm text-foreground">{toTitleCase(matter.status)}</p>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Orders & outcome</CardTitle>
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
        <CardContent>
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Retained assignments</CardTitle>
          {myActiveRetained ? (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setPendingEnd(myActiveRetained.id)}
            >
              End my retention
            </Button>
          ) : canManage ? (
            <Button size="sm" variant="outline" onClick={() => setRetainOpen(true)}>
              <Bookmark className="h-3.5 w-3.5" />
              Retain as part-heard
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {assignmentsPending ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : assignmentsError ? (
            <InlineError error={assignmentsErr} className="border-0 p-0" />
          ) : !assignments || assignments.length === 0 ? (
            <EmptyState
              className="border-0 py-6"
              title="No retained assignments"
              description="A magistrate whose ordinary Court access ends can retain this specific matter as part-heard."
            />
          ) : (
            <ul className="space-y-3 text-sm">
              {assignments.map((a) => (
                <li key={a.id} className="border-b border-border pb-2 last:border-0">
                  <p className="font-medium text-foreground">
                    {a.display_name ?? "Unknown magistrate"}
                    {!a.ended_at && (
                      <span className="ml-2 text-xs font-normal text-primary">
                        Active
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {toTitleCase(a.reason)} · started{" "}
                    {formatDateTime(a.started_at)}
                    {a.ended_at ? ` · ended ${formatDateTime(a.ended_at)}` : ""}
                  </p>
                  {a.notes && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{a.notes}</p>
                  )}
                </li>
              ))}
            </ul>
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
    </div>
  );
}
