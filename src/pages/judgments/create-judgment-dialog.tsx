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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { useCreateJudgment } from "@/hooks/judgments/use-judgments";
import {
  judgmentCreateSchema,
  type JudgmentCreateFormValues,
} from "@/lib/validations/judgment";
import { ROUTES } from "@/routes/paths";

interface CreateJudgmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateJudgmentDialog({ open, onOpenChange }: CreateJudgmentDialogProps) {
  const navigate = useNavigate();
  const createJudgment = useCreateJudgment();

  const form = useForm<JudgmentCreateFormValues>({
    resolver: zodResolver(judgmentCreateSchema),
    defaultValues: { title: "", case_number: "", court_name: "", judgment_date: "", citation: "" },
  });

  async function onSubmit(values: JudgmentCreateFormValues) {
    try {
      const created = await createJudgment.mutateAsync({
        title: values.title,
        case_number: values.case_number || null,
        court_name: values.court_name || null,
        judgment_date: values.judgment_date || null,
        citation: values.citation || null,
      });
      onOpenChange(false);
      form.reset();
      navigate(ROUTES.judgmentDetail(created.id));
    } catch {
      // Surfaced globally via the mutation cache toast subscriber.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New draft judgment</DialogTitle>
          <DialogDescription>
            Start a draft. All fields except title are optional and can be
            filled in afterward.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Police v. John Doe" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="case_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Case number (optional)</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="judgment_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Judgment date (optional)</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="court_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Court name (optional)</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="citation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Citation (optional)</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={createJudgment.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createJudgment.isPending}>
                {createJudgment.isPending && (
                  <LoadingSpinner className="text-current" size={16} />
                )}
                Create draft
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
