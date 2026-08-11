import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Check } from "lucide-react";
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
import { useCreateBenchNote } from "@/hooks/bench-notes/use-bench-notes";
import { useDocketMatters } from "@/hooks/docket/use-docket-matters";
import { useJudgments } from "@/hooks/judgments/use-judgments";
import { useCaseLawList } from "@/hooks/case-law/use-case-law";
import { useStatutes } from "@/hooks/legislation/use-legislation";
import {
  BENCH_NOTE_PICKABLE_PARENT_TYPES,
  benchNoteCreateSchema,
  type BenchNoteCreateFormValues,
  type BenchNoteParentType,
} from "@/lib/validations/bench-note";
import { ROUTES } from "@/routes/paths";
import { cn } from "@/lib/utils";

const PARENT_TYPE_LABELS: Record<BenchNoteParentType, string> = {
  docket_matter: "Docket Matter",
  judgment: "Judgment",
  case_law: "Case Law",
  statute: "Legislation",
  statute_provision: "Legislation Provision",
};

interface CreateBenchNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill "About" when opened from a specific record's page (e.g. a Legislation detail page's "New Bench Note" action) rather than the general Bench Notes list. */
  defaultParent?: { entityType: BenchNoteParentType; entityId: string; label: string };
}

export function CreateBenchNoteDialog({
  open,
  onOpenChange,
  defaultParent,
}: CreateBenchNoteDialogProps) {
  const navigate = useNavigate();
  const createBenchNote = useCreateBenchNote();
  const [parentFilter, setParentFilter] = useState("");

  const form = useForm<BenchNoteCreateFormValues>({
    resolver: zodResolver(benchNoteCreateSchema),
    defaultValues: {
      title: "",
      entity_type: defaultParent?.entityType ?? "docket_matter",
      entity_id: defaultParent?.entityId ?? "",
    },
  });

  const parentType = form.watch("entity_type");
  const lockParent = !!defaultParent;

  const { data: matters } = useDocketMatters(parentType === "docket_matter" ? parentFilter : "");
  const { data: judgments } = useJudgments();
  const { data: caseLaw } = useCaseLawList();
  const { data: statutes } = useStatutes();

  const options = useMemo(() => {
    const q = parentFilter.trim().toLowerCase();
    if (parentType === "docket_matter") {
      return (matters ?? []).map((m) => ({
        id: m.id,
        label: m.matter_title,
        subtitle: m.case_number,
      }));
    }
    if (parentType === "judgment") {
      return (judgments ?? [])
        .filter((j) => !q || j.title.toLowerCase().includes(q))
        .map((j) => ({ id: j.id, label: j.title, subtitle: j.case_number }));
    }
    if (parentType === "statute") {
      return (statutes ?? [])
        .filter((s) => !q || s.title.toLowerCase().includes(q))
        .map((s) => ({ id: s.id, label: s.title, subtitle: s.code }));
    }
    return (caseLaw ?? [])
      .filter((c) => !q || c.case_name.toLowerCase().includes(q))
      .map((c) => ({ id: c.id, label: c.case_name, subtitle: c.citation }));
  }, [parentType, matters, judgments, caseLaw, statutes, parentFilter]);

  async function onSubmit(values: BenchNoteCreateFormValues) {
    try {
      const created = await createBenchNote.mutateAsync(values);
      onOpenChange(false);
      form.reset();
      setParentFilter("");
      navigate(ROUTES.benchNoteDetail(created.id));
    } catch {
      // Surfaced globally via the mutation cache toast subscriber.
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          form.reset();
          setParentFilter("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Bench Note</DialogTitle>
          <DialogDescription>
            {lockParent
              ? `Attach a note to ${defaultParent.label}.`
              : "Attach a note to a Docket Matter, Judgment, Case Law entry, or Act you currently have access to."}
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
                    <Input placeholder="e.g. Bail conditions to revisit" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {lockParent ? (
              <FormItem>
                <FormLabel>About</FormLabel>
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
                  {PARENT_TYPE_LABELS[parentType]}: {defaultParent.label}
                </div>
              </FormItem>
            ) : (
              <>
                <FormField
                  control={form.control}
                  name="entity_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>About</FormLabel>
                      <FormControl>
                        <Select
                          value={field.value}
                          onChange={(e) => {
                            field.onChange(e.target.value as BenchNoteParentType);
                            form.setValue("entity_id", "");
                            setParentFilter("");
                          }}
                        >
                          {BENCH_NOTE_PICKABLE_PARENT_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {PARENT_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </Select>
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="entity_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{PARENT_TYPE_LABELS[parentType]}</FormLabel>
                      <Input
                        placeholder={`Search ${PARENT_TYPE_LABELS[parentType].toLowerCase()}s…`}
                        value={parentFilter}
                        onChange={(e) => setParentFilter(e.target.value)}
                      />
                      <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
                        {options.length === 0 ? (
                          <p className="p-2 text-sm text-muted-foreground">No matches.</p>
                        ) : (
                          options.slice(0, 50).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => field.onChange(opt.id)}
                              className={cn(
                                "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                                field.value === opt.id && "bg-muted",
                              )}
                            >
                              <span>
                                <span className="text-foreground">{opt.label}</span>
                                {opt.subtitle && (
                                  <span className="text-muted-foreground"> · {opt.subtitle}</span>
                                )}
                              </span>
                              {field.value === opt.id && <Check className="h-4 w-4 text-primary" />}
                            </button>
                          ))
                        )}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={createBenchNote.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createBenchNote.isPending}>
                {createBenchNote.isPending && (
                  <LoadingSpinner className="text-current" size={16} />
                )}
                Create note
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
