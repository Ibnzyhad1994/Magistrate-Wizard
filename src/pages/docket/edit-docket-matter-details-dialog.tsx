import { useEffect } from "react";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { useUpdateDocketMatter } from "@/hooks/docket/use-docket-matters";
import {
  docketMatterIdentitySchema,
  type DocketMatterIdentityFormValues,
} from "@/lib/validations/docket";
import { isConcurrentEditError } from "@/lib/concurrency";
import type { DocketMatter } from "@/types/database.types";

interface EditDocketMatterDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matter: DocketMatter & {
    courts: { id: string; name: string; jurisdiction: string } | null;
    magisterial_districts: { id: string; name: string } | null;
  };
}

export function EditDocketMatterDetailsDialog({
  open,
  onOpenChange,
  matter,
}: EditDocketMatterDetailsDialogProps) {
  const updateMatter = useUpdateDocketMatter(matter.id);
  const form = useForm<DocketMatterIdentityFormValues>({
    resolver: zodResolver(docketMatterIdentitySchema),
    defaultValues: {
      case_number: matter.case_number,
      matter_title: matter.matter_title,
      charge_or_issue: matter.charge_or_issue ?? "",
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      case_number: matter.case_number,
      matter_title: matter.matter_title,
      charge_or_issue: matter.charge_or_issue ?? "",
    });
  }, [open, matter.case_number, matter.matter_title, matter.charge_or_issue, matter.updated_at, form]);

  async function onSubmit(values: DocketMatterIdentityFormValues) {
    try {
      await updateMatter.mutateAsync({
        values: {
          case_number: values.case_number.trim(),
          matter_title: values.matter_title.trim(),
          charge_or_issue: values.charge_or_issue?.trim() || null,
        },
        expectedUpdatedAt: matter.updated_at,
      });
      onOpenChange(false);
    } catch (err) {
      if (isConcurrentEditError(err)) {
        onOpenChange(false);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
          <DialogDescription>
            Case number, title, and charge can be corrected. Court and district stay with this file.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">Court</p>
              <p className="font-medium text-foreground">{matter.courts?.name ?? "—"}</p>
            </div>
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">Magisterial district</p>
              <p className="font-medium text-foreground">
                {matter.magisterial_districts?.name ?? "—"}
              </p>
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
                disabled={updateMatter.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={updateMatter.isPending}>
                {updateMatter.isPending && (
                  <LoadingSpinner className="text-current" size={16} />
                )}
                Save
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
