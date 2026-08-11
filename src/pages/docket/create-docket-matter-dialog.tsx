import { useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
import { useCourts, useMagisterialDistricts } from "@/hooks/docket/use-lookups";
import { useCreateDocketMatter } from "@/hooks/docket/use-docket-matters";
import { docketMatterSchema, type DocketMatterFormValues } from "@/lib/validations/docket";
import { ROUTES } from "@/routes/paths";

interface CreateDocketMatterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateDocketMatterDialog({
  open,
  onOpenChange,
}: CreateDocketMatterDialogProps) {
  const navigate = useNavigate();
  const { data: courts, isPending: courtsPending } = useCourts();
  const { data: districts, isPending: districtsPending } =
    useMagisterialDistricts();
  const createMatter = useCreateDocketMatter();

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
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="court_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Court</FormLabel>
                    <FormControl>
                      <Select
                        {...field}
                        disabled={courtsPending}
                        aria-label="Court"
                      >
                        <option value="">Select a court…</option>
                        {courts?.map((c) => (
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
              <FormField
                control={form.control}
                name="district_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>District</FormLabel>
                    <FormControl>
                      <Select
                        {...field}
                        disabled={districtsPending}
                        aria-label="Magisterial district"
                      >
                        <option value="">Select a district…</option>
                        {districts?.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
              <Button type="submit" disabled={createMatter.isPending}>
                {createMatter.isPending && (
                  <LoadingSpinner className="text-current" size={16} />
                )}
                Create matter
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
