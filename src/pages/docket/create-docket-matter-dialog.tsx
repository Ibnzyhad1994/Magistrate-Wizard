import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Landmark } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { EmptyState } from "@/components/common/empty-state";
import { useMyCurrentCourts } from "@/hooks/docket/use-lookups";
import { useCreateDocketMatter } from "@/hooks/docket/use-docket-matters";
import { docketMatterSchema, type DocketMatterFormValues } from "@/lib/validations/docket";
import { ROUTES } from "@/routes/paths";

interface CreateDocketMatterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The two-level Docket's current scope (0097). When set (the dialog was
   * opened from a specific court's Docket view), the Court field is
   * pre-filled AND locked to that exact court — "Automatically assign
   * [that court] as the matter's court_id... do not silently use another
   * court." When absent (opened from All My Courts), the full picker
   * below (still scoped to the caller's own authorized courts only)
   * applies, and the user must choose one before saving.
   */
  defaultCourtId?: string | null;
}

/**
 * The Court selector here is deliberately scoped to the caller's own
 * CURRENT court assignments (`useMyCurrentCourts()` — magistrate_courts
 * or clerk_courts, role-aware) rather than the full active-Court
 * reference list — offering a Court the caller has no authority over
 * would let the UI imply a choice that `docket_matters` INSERT RLS
 * (current Court assignment OR active clerk assignment) will always
 * reject. The database re-validates the selected court independently
 * regardless of what this form shows or locks (docket_matters_guard(),
 * 0020/0097) — this UI convenience is never the actual security
 * boundary. Magisterial District is derived read-only display, not an
 * independent field: `docket_matters` already derives/enforces
 * `district_id` from `court_id -> courts.district_id` via a backend
 * trigger, so presenting it as a second free choice would be misleading
 * and, if it disagreed with the selected Court, simply overwritten or
 * rejected server-side anyway.
 */
export function CreateDocketMatterDialog({
  open,
  onOpenChange,
  defaultCourtId,
}: CreateDocketMatterDialogProps) {
  const navigate = useNavigate();
  const { data: myCourts, isPending: courtsPending } = useMyCurrentCourts();
  const createMatter = useCreateDocketMatter();
  const lockedCourt = defaultCourtId ? myCourts?.find((c) => c.court_id === defaultCourtId) : undefined;

  const form = useForm<DocketMatterFormValues>({
    resolver: zodResolver(docketMatterSchema),
    defaultValues: {
      court_id: "",
      district_id: "",
      case_number: "",
      matter_title: "",
      charge_or_issue: "",
      status: "active",
    },
  });

  // Pre-fill (and, via the disabled picker below, lock) the Court field
  // once the caller's authorized-courts list has loaded and confirms the
  // requested scope is genuinely one of them. If defaultCourtId is somehow
  // not in myCourts (e.g. access was revoked between opening the Docket
  // page and opening this dialog), lockedCourt stays undefined and the
  // form correctly falls back to the ordinary open picker instead of
  // silently submitting an unauthorized court.
  useEffect(() => {
    if (open && lockedCourt) {
      form.setValue("court_id", lockedCourt.court_id, { shouldValidate: true });
      form.setValue("district_id", lockedCourt.district_id ?? "", { shouldValidate: true });
    }
  }, [open, lockedCourt, form]);

  const selectedCourtId = form.watch("court_id");
  const selectedCourt = myCourts?.find((c) => c.court_id === selectedCourtId);
  const noCourts = !courtsPending && (myCourts?.length ?? 0) === 0;
  const missingDistrict = !!selectedCourtId && !!selectedCourt && !selectedCourt.district_id;

  function handleCourtChange(courtId: string) {
    const court = myCourts?.find((c) => c.court_id === courtId);
    form.setValue("court_id", courtId, { shouldValidate: true });
    form.setValue("district_id", court?.district_id ?? "", { shouldValidate: true });
  }

  async function onSubmit(values: DocketMatterFormValues) {
    try {
      const created = await createMatter.mutateAsync({
        ...values,
        charge_or_issue: values.charge_or_issue || null,
      });
      onOpenChange(false);
      form.reset();
      navigate(ROUTES.docketMatter(created.id));
    } catch {
      // Surfaced globally via the mutation cache toast subscriber.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New docket matter</DialogTitle>
          <DialogDescription>
            Create a new matter on your docket. You can add events, parties,
            and other details afterward.
          </DialogDescription>
        </DialogHeader>

        {courtsPending ? null : noCourts ? (
          <EmptyState
            icon={Landmark}
            title="No current Court assignment"
            description="You're not currently assigned to a Court, so you can't create a Docket Matter yet. Contact an administrator for a Court assignment."
          />
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="court_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Court</FormLabel>
                    <FormControl>
                      {lockedCourt ? (
                        <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm text-foreground">
                          {lockedCourt.court_name}
                        </div>
                      ) : (
                        <Select
                          {...field}
                          onChange={(e) => handleCourtChange(e.target.value)}
                          aria-label="Court"
                        >
                          <option value="">Select a court…</option>
                          {myCourts?.map((c) => (
                            <option key={c.court_id} value={c.court_id}>
                              {c.court_name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </FormControl>
                    {lockedCourt && (
                      <p className="text-xs text-muted-foreground">
                        This matter will be created on the docket you currently have open.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {selectedCourtId && (
                <p className="text-sm text-muted-foreground">
                  Magisterial District:{" "}
                  {selectedCourt?.district_name ? (
                    <span className="font-medium text-foreground">
                      {selectedCourt.district_name}
                    </span>
                  ) : (
                    <span className="text-destructive">
                      Not set. Contact an administrator before creating a
                      matter here.
                    </span>
                  )}
                </p>
              )}

              <FormField
                control={form.control}
                name="case_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Case number</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. 12345/2026" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="matter_title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Matter title</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Police v. John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="charge_or_issue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Charge / issue (optional)</FormLabel>
                    <FormControl>
                      <Textarea rows={3} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={createMatter.isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createMatter.isPending || missingDistrict}>
                  {createMatter.isPending && (
                    <LoadingSpinner className="text-current" size={16} />
                  )}
                  Create matter
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
