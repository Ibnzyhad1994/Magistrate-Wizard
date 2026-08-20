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
import { DateOnlyInput } from "@/components/common/date-only-input";
import { useCreatePersonalCaseLaw } from "@/hooks/case-law/use-case-law";
import { useLegalCaseCategories } from "@/hooks/legal-library/use-legal-taxonomy";
import {
  caseLawFieldsSchema,
  type CaseLawFieldsFormValues,
} from "@/lib/validations/case-law";
import { ROUTES } from "@/routes/paths";

interface CreateCaseLawDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Always creates PERSONAL research — canonical Case Law is Admin-maintained and not created here. */
export function CreateCaseLawDialog({ open, onOpenChange }: CreateCaseLawDialogProps) {
  const navigate = useNavigate();
  const createCaseLaw = useCreatePersonalCaseLaw();
  const { data: categories } = useLegalCaseCategories();

  const form = useForm<CaseLawFieldsFormValues>({
    resolver: zodResolver(caseLawFieldsSchema),
    defaultValues: {
      case_name: "",
      citation: "",
      court: "",
      jurisdiction: "",
      decided_date: "",
      source_url: "",
      summary: "",
      full_text: "",
      category_id: "",
    },
  });

  async function onSubmit(values: CaseLawFieldsFormValues) {
    try {
      const created = await createCaseLaw.mutateAsync({
        case_name: values.case_name,
        citation: values.citation,
        court: values.court,
        jurisdiction: values.jurisdiction,
        decided_date: values.decided_date || null,
        source_url: values.source_url || null,
        summary: values.summary || null,
        full_text: values.full_text || null,
        category_id: values.category_id || null,
      });
      onOpenChange(false);
      form.reset();
      navigate(ROUTES.caseLawDetail(created.id));
    } catch {
      // Surfaced globally via the mutation cache toast subscriber.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New research entry</DialogTitle>
          <DialogDescription>
            Personal research is private to you until you choose to make it
            discoverable.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <FormField
              control={form.control}
              name="case_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Case name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. R v. Smith" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="category_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category (optional)</FormLabel>
                  <FormControl>
                    <Select value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value)}>
                      <option value="">No category</option>
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
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="citation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Citation</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="decided_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Decided date (optional)</FormLabel>
                    <FormControl>
                      <DateOnlyInput
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        aria-label="Decided date"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="court"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Court</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="jurisdiction"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Jurisdiction</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="source_url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Source URL (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="https://…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="summary"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Summary (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="full_text"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full text (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={6} {...field} />
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
                disabled={createCaseLaw.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createCaseLaw.isPending}>
                {createCaseLaw.isPending && (
                  <LoadingSpinner className="text-current" size={16} />
                )}
                Create entry
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
