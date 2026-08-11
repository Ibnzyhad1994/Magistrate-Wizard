import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Pencil } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
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
import { useUpdateDocketMatter } from "@/hooks/docket/use-docket-matters";
import { useDocketAssignments } from "@/hooks/docket/use-docket-assignments";
import {
  DOCKET_MATTER_STATUSES,
  docketMatterOutcomeSchema,
  type DocketMatterOutcomeFormValues,
} from "@/lib/validations/docket";
import { formatDateTime } from "@/lib/utils";
import type { DocketMatter } from "@/types/database.types";

interface OverviewSectionProps {
  matter: DocketMatter & {
    courts: { id: string; name: string; jurisdiction: string } | null;
    magisterial_districts: { id: string; name: string } | null;
  };
}

export function OverviewSection({ matter }: OverviewSectionProps) {
  const [editingOutcome, setEditingOutcome] = useState(false);
  const updateMatter = useUpdateDocketMatter(matter.id);
  const {
    data: assignments,
    isPending: assignmentsPending,
    isError: assignmentsError,
    error: assignmentsErr,
  } = useDocketAssignments(matter.id);

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent>
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
                {s}
              </option>
            ))}
          </Select>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Orders & outcome</CardTitle>
          {!editingOutcome && (
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
        <CardHeader>
          <CardTitle className="text-base">Assignment history</CardTitle>
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
              description="This matter is only governed by the standard Court assignment."
            />
          ) : (
            <ul className="space-y-3 text-sm">
              {assignments.map((a) => (
                <li key={a.id} className="border-b border-border pb-2 last:border-0">
                  <p className="font-medium text-foreground">
                    {a.display_name ?? "Unknown magistrate"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {a.reason.replace(/_/g, " ")} · started{" "}
                    {formatDateTime(a.started_at)}
                    {a.ended_at ? ` · ended ${formatDateTime(a.ended_at)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
