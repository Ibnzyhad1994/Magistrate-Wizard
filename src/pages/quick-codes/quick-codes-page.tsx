import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Plus, Copy, Pencil, Trash2, Braces, Link2, Bookmark, BookmarkCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { BrowseHeader, BrowsePage } from "@/components/browse";
import { InlineError } from "@/components/common/inline-error";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { ControlledVocabSelect } from "@/components/common/controlled-vocab-select";
import {
  useCreateQuickCode,
  useDeleteQuickCode,
  useQuickCodes,
  useUpdateQuickCode,
} from "@/hooks/quick-codes/use-quick-codes";
import {
  useQuickCodeCaseLaw,
  useQuickCodeDocketMatters,
  useQuickCodeJudgments,
} from "@/hooks/quick-codes/use-quick-code-associations";
import {
  QUICK_CODE_CATEGORIES,
  quickCodeFieldsSchema,
  type QuickCodeFieldsFormValues,
} from "@/lib/validations/quick-code";
import { toast } from "sonner";
import { useAddBookmark, useIsBookmarked, useRemoveBookmark } from "@/hooks/bookmarks/use-bookmarks";
import type { QuickCode } from "@/types/database.types";
import { cn } from "@/lib/utils";

export default function QuickCodesPage() {
  const { data, isPending, isError, error, refetch } = useQuickCodes();
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<QuickCode | null>(null);
  const [pendingDelete, setPendingDelete] = useState<QuickCode | null>(null);
  const [associationsFor, setAssociationsFor] = useState<QuickCode | null>(null);
  const deleteQuickCode = useDeleteQuickCode();

  // Quick Codes have no standalone detail route, so a Bookmark (or any
  // other deep link) targets this list with `?qc=<id>` instead. Rather
  // than dropping the user into an undifferentiated list, scroll to and
  // briefly highlight that specific row.
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get("qc");
  const [flashId, setFlashId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  useEffect(() => {
    if (!highlightId || !data) return;
    const row = rowRefs.current.get(highlightId);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashId(highlightId);
      const timeout = setTimeout(() => setFlashId(null), 2500);
      // Clear the param so refreshing/reordering later doesn't re-trigger
      // the scroll, while leaving the highlight visible for this visit.
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("qc");
        return next;
      }, { replace: true });
      return () => clearTimeout(timeout);
    }
  }, [highlightId, data, setSearchParams]);

  const categoriesInUse = useMemo(() => {
    const present = new Set((data ?? []).map((qc) => qc.category).filter(Boolean) as string[]);
    return Array.from(new Set([...QUICK_CODE_CATEGORIES, ...present])).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((qc) => {
      if (categoryFilter && (qc.category ?? "") !== categoryFilter) return false;
      if (!q) return true;
      return (
        qc.code_word.toLowerCase().includes(q) ||
        (qc.title ?? "").toLowerCase().includes(q) ||
        (qc.description ?? "").toLowerCase().includes(q) ||
        (qc.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, query, categoryFilter]);

  async function copyContent(qc: QuickCode) {
    try {
      await navigator.clipboard.writeText(qc.content);
      toast.success(`Copied "${qc.code_word}" to clipboard.`);
    } catch {
      toast.error("Couldn't copy to clipboard.");
    }
  }

  return (
    <BrowsePage>
      <BrowseHeader
        title="Quick Codes"
        description="Reusable boilerplate text, private to you."
        action={
          <Button
            variant="play"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            New Quick Code
          </Button>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          className="max-w-sm"
          placeholder="Filter by code word, title, or description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter Quick Codes"
        />
        {categoriesInUse.length > 0 && (
          <Select
            className="w-full sm:w-48"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {categoriesInUse.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        )}
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Braces}
              className="border-0"
              title={data && data.length > 0 ? "No matches" : "No Quick Codes yet"}
              description={
                data && data.length > 0
                  ? "Try a different search term."
                  : "Create reusable snippets you can quickly copy into judgments, notes, or anywhere else you write."
              }
              action={
                (!data || data.length === 0) && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditing(null);
                      setFormOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    New Quick Code
                  </Button>
                )
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code word</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Preview</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((qc) => (
                  <TableRow
                    key={qc.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(qc.id, el);
                      else rowRefs.current.delete(qc.id);
                    }}
                    className={cn(flashId === qc.id && "bg-primary/10 transition-colors duration-1000")}
                  >
                    <TableCell className="font-mono font-medium text-foreground">
                      {qc.code_word}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{qc.title || "—"}</TableCell>
                    <TableCell>
                      {qc.category ? (
                        <Badge variant="secondary">{qc.category}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {qc.content}
                    </TableCell>
                    <TableCell className="text-right">
                      <QuickCodeBookmarkButton quickCodeId={qc.id} />
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Copy ${qc.code_word}`}
                        onClick={() => void copyContent(qc)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`View associations for ${qc.code_word}`}
                        onClick={() => setAssociationsFor(qc)}
                      >
                        <Link2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit ${qc.code_word}`}
                        onClick={() => {
                          setEditing(qc);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${qc.code_word}`}
                        onClick={() => setPendingDelete(qc)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <QuickCodeFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
      />

      <AssociationsDialog
        quickCode={associationsFor}
        onOpenChange={(open) => !open && setAssociationsFor(null)}
      />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this Quick Code?"
        description={
          pendingDelete
            ? `"${pendingDelete.code_word}" will be permanently deleted. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        isConfirming={deleteQuickCode.isPending}
        onConfirm={() => {
          if (pendingDelete) {
            deleteQuickCode.mutate(pendingDelete.id, {
              onSuccess: () => setPendingDelete(null),
            });
          }
        }}
      />
    </BrowsePage>
  );
}

function QuickCodeBookmarkButton({ quickCodeId }: { quickCodeId: string }) {
  const { data: existing, isPending } = useIsBookmarked("quick_code", quickCodeId);
  const addBookmark = useAddBookmark();
  const removeBookmark = useRemoveBookmark();

  if (isPending) {
    return (
      <Button size="icon" variant="ghost" disabled aria-label="Loading bookmark state">
        <LoadingSpinner size={16} />
      </Button>
    );
  }

  if (existing) {
    return (
      <Button
        size="icon"
        variant="ghost"
        aria-label="Remove bookmark"
        disabled={removeBookmark.isPending}
        onClick={() =>
          removeBookmark.mutate({ id: existing.id, entityType: "quick_code", entityId: quickCodeId })
        }
      >
        <BookmarkCheck className="h-4 w-4 text-primary" />
      </Button>
    );
  }

  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label="Bookmark"
      disabled={addBookmark.isPending}
      onClick={() => addBookmark.mutate({ entityType: "quick_code", entityId: quickCodeId })}
    >
      <Bookmark className="h-4 w-4" />
    </Button>
  );
}

function QuickCodeFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: QuickCode | null;
}) {
  const createQuickCode = useCreateQuickCode();
  const updateQuickCode = useUpdateQuickCode(editing?.id ?? "");

  const form = useForm<QuickCodeFieldsFormValues>({
    resolver: zodResolver(quickCodeFieldsSchema),
    values: {
      code_word: editing?.code_word ?? "",
      title: editing?.title ?? "",
      content: editing?.content ?? "",
      description: editing?.description ?? "",
      category: editing?.category ?? "",
    },
  });

  async function onSubmit(values: QuickCodeFieldsFormValues) {
    const payload = {
      code_word: values.code_word,
      title: values.title || null,
      content: values.content,
      description: values.description || null,
      category: values.category || null,
    };
    try {
      if (editing) {
        await updateQuickCode.mutateAsync(payload);
      } else {
        await createQuickCode.mutateAsync(payload);
      }
      onOpenChange(false);
      form.reset();
    } catch {
      // Surfaced globally via the mutation cache toast subscriber.
    }
  }

  const isPending = createQuickCode.isPending || updateQuickCode.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Quick Code" : "New Quick Code"}</DialogTitle>
          <DialogDescription>
            Private to you. Code word must be unique among your own Quick
            Codes.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="code_word"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code word</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. .adjourn" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title (optional)</FormLabel>
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
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category (optional)</FormLabel>
                  <FormControl>
                    <ControlledVocabSelect
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      options={QUICK_CODE_CATEGORIES}
                      placeholder="No category"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="content"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Content</FormLabel>
                  <FormControl>
                    <Textarea rows={5} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
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
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <LoadingSpinner className="text-current" size={16} />}
                {editing ? "Save changes" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function AssociationsDialog({
  quickCode,
  onOpenChange,
}: {
  quickCode: QuickCode | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = !!quickCode;
  const { data: matters, isPending: mattersPending } = useQuickCodeDocketMatters(
    quickCode?.id ?? "",
    open,
  );
  const { data: judgments, isPending: judgmentsPending } = useQuickCodeJudgments(
    quickCode?.id ?? "",
    open,
  );
  const { data: caseLaw, isPending: caseLawPending } = useQuickCodeCaseLaw(
    quickCode?.id ?? "",
    open,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Associations for {quickCode?.code_word}</DialogTitle>
          <DialogDescription>
            Where this Quick Code has been linked.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <AssociationGroup
            title="Docket Matters"
            isPending={mattersPending}
            items={matters?.map((m) => m.docket_matters?.matter_title ?? null) ?? []}
          />
          <AssociationGroup
            title="Judgments"
            isPending={judgmentsPending}
            items={judgments?.map((j) => j.judgments?.title ?? null) ?? []}
          />
          <AssociationGroup
            title="Case Law"
            isPending={caseLawPending}
            items={caseLaw?.map((c) => c.case_law?.case_name ?? null) ?? []}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssociationGroup({
  title,
  isPending,
  items,
}: {
  title: string;
  isPending: boolean;
  items: (string | null)[];
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {isPending ? (
        <Skeleton className="h-6 w-full" />
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">None</p>
      ) : (
        <ul className="space-y-1">
          {items.map((label, i) => (
            <li key={i} className="text-foreground">
              {label ?? <span className="italic text-muted-foreground">Unavailable</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
