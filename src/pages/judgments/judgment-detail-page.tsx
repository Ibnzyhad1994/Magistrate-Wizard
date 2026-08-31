import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Lock, LockOpen, Trash2, CheckCircle2, Sparkles, Pencil } from "lucide-react";
import type { JSONContent } from "@tiptap/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { RichTextEditor } from "@/components/common/rich-text-editor";
import { DocumentsPanel } from "@/components/common/documents-panel";
import { BookmarkToggle } from "@/components/common/bookmark-toggle";
import { TagInput } from "@/components/common/tag-input";
import { DateOnlyInput } from "@/components/common/date-only-input";
import { CategoryField } from "@/components/legal-library/taxonomy-fields";
import {
  useDeleteJudgment,
  useFinalizeJudgment,
  useJudgment,
  useSetJudgmentCategory,
  useSetJudgmentDiscoverable,
  useUnlockJudgment,
  useUpdateJudgmentContent,
  useUpdateJudgmentFields,
} from "@/hooks/judgments/use-judgments";
import {
  useAddJudgmentTag,
  useJudgmentTags,
  useRemoveJudgmentTag,
} from "@/hooks/judgments/use-judgment-tags";
import {
  useJudgmentDocketMatters,
  useJudgmentQuickCodes,
} from "@/hooks/judgments/use-judgment-links";
import { useLegalCaseCategories } from "@/hooks/legal-library/use-legal-taxonomy";
import { useDocuments, downloadDocumentAsFile } from "@/hooks/use-documents";
import { ingestDocument } from "@/lib/ingest-document";
import { proposeTagsScored } from "@/lib/legal-extraction";
import { suggestCategoryFromTopics } from "@/lib/legal-taxonomy";
import {
  judgmentFieldsSchema,
  type JudgmentFieldsFormValues,
} from "@/lib/validations/judgment";
import { formatDate, formatDateTime, getErrorMessage, toTitleCase } from "@/lib/utils";
import { ROUTES } from "@/routes/paths";
import { useBackNav } from "@/hooks/use-back-nav";
import { Billboard } from "@/components/browse";
import { toast } from "sonner";

/**
 * Runs the same deterministic extraction + tag-proposal pipeline the
 * admin Legal Library ingestion already uses (`ingestDocument`,
 * `proposeTagsScored` — see src/lib/legal-extraction.ts) over one
 * Judgment document, then automatically applies the result: every
 * medium/high-confidence proposed tag not already on this judgment (never
 * "low" confidence — those are noisy single-word matches, left for the
 * magistrate to add by hand if they judge it relevant), and, only when no
 * Category is set yet, the best-mapped `legal_case_categories` suggestion
 * (`suggestCategoryFromTopics`) — an existing Category is never
 * overwritten. `judgment_tags` is owner-writable with no admin gate
 * (0028), so this runs entirely as the signed-in owner, no elevated path
 * needed. Used both automatically right after a new upload and on demand
 * for a document already attached before this feature existed.
 */
function useAutoClassifyJudgment(judgmentId: string, currentCategoryId: string | null) {
  const addTag = useAddJudgmentTag(judgmentId);
  const setCategory = useSetJudgmentCategory(judgmentId);
  const { data: categories } = useLegalCaseCategories();
  const { data: existingTags } = useJudgmentTags(judgmentId);
  const [isRunning, setIsRunning] = useState(false);

  async function run(file: File) {
    setIsRunning(true);
    try {
      const envelope = await ingestDocument(file);
      if (!envelope.text?.trim()) {
        toast.message(
          "Couldn't extract text from this document to generate tags. Paste the text into Content, or add tags manually.",
        );
        return;
      }
      const proposals = proposeTagsScored(envelope.text);
      const existingNames = new Set((existingTags ?? []).map((t) => t.tag_name.toLowerCase()));
      const newTags = proposals.filter(
        (p) => p.confidence !== "low" && !existingNames.has(p.name.toLowerCase()),
      );
      for (const t of newTags) {
        await addTag.mutateAsync(t.name);
      }

      let categoryName: string | null = null;
      if (!currentCategoryId) {
        const suggested = suggestCategoryFromTopics(proposals);
        const match = suggested ? (categories ?? []).find((c) => c.name === suggested) : null;
        if (match) {
          await setCategory.mutateAsync(match.id);
          categoryName = match.name;
        }
      }

      if (newTags.length === 0 && !categoryName) {
        toast.message("No confident tags or category found in this document. Add them manually if needed.");
      } else {
        toast.success(
          [
            newTags.length > 0 ? `${newTags.length} tag${newTags.length === 1 ? "" : "s"} added` : null,
            categoryName ? `category set to "${categoryName}"` : null,
          ]
            .filter(Boolean)
            .join(", ") + " from the document.",
        );
      }
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setIsRunning(false);
    }
  }

  return { run, isRunning };
}

export default function JudgmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const back = useBackNav(ROUTES.judgments, "Back to Judgments");
  const { data: judgment, isPending, isError, error, refetch } = useJudgment(id);
  const { data: categories } = useLegalCaseCategories();
  // Both called unconditionally, before the early returns below, so this
  // component's hook-call sequence never changes across renders —
  // `judgment` may still be undefined on the first render. `documents`
  // backs the "Generate from document" manual trigger (an already-
  // attached document, from before this feature existed).
  const autoClassify = useAutoClassifyJudgment(id ?? "", judgment?.category_id ?? null);
  const { data: documents } = useDocuments("judgment", id);
  const [contentDirty, setContentDirty] = useState(false);

  async function runFromLatestDocument() {
    const latest = (documents ?? [])[0];
    if (!latest) {
      toast.message("No document attached yet. Upload one first, on the Documents tab.");
      return;
    }
    try {
      const file = await downloadDocumentAsFile(latest.id);
      await autoClassify.run(file);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  if (isPending) {
    return (
      <div className="browse-gutter space-y-4 pt-24">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError) return <InlineError error={error} onRetry={() => void refetch()} />;
  if (!judgment) {
    return (
      <InlineError
        error={new Error("This judgment doesn't exist, or you don't have access to it.")}
      />
    );
  }

  const isDraft = judgment.status === "draft";
  const categoryName = (categories ?? []).find((c) => c.id === judgment.category_id)?.name;

  return (
    <>
      <Billboard
        variant="detail"
        eyebrow={judgment.case_number ?? undefined}
        title={judgment.title}
        description={
          [
            judgment.citation,
            !isDraft && judgment.finalized_at
              ? `Finalized ${formatDateTime(judgment.finalized_at)}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        badges={[toTitleCase(judgment.status)]}
        tone="judgment"
        primaryAction={{ label: back.label, onClick: () => navigate(back.to) }}
      />
      <div className="browse-gutter relative z-10 -mt-6 space-y-4 pb-20">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={isDraft ? "secondary" : "default"}>{toTitleCase(judgment.status)}</Badge>
          {categoryName && <Badge variant="outline">{categoryName}</Badge>}
          <BookmarkToggle entityType="judgment" entityId={judgment.id} />
        </div>

      <LifecycleBar judgment={judgment} contentDirty={contentDirty} />

      <ContentCard judgment={judgment} isDraft={isDraft} onDirtyChange={setContentDirty} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <FieldsCard judgment={judgment} isDraft={isDraft} />
        </div>
        <div className="space-y-3">
          <DiscoverabilityCard judgment={judgment} />
          <ClassificationCard
            judgmentId={judgment.id}
            categoryId={judgment.category_id}
            onGenerateFromDocument={() => void runFromLatestDocument()}
            isGenerating={autoClassify.isRunning}
          />
        </div>
      </div>

      <Tabs defaultValue="links">
        <TabsList>
          <TabsTrigger value="links">Links</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>
        <TabsContent value="links">
          <LinksPanel judgmentId={judgment.id} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsPanel
            entityType="judgment"
            entityId={judgment.id}
            onUploaded={(file) => void autoClassify.run(file)}
          />
        </TabsContent>
      </Tabs>
    </div>
    </>
  );
}

function LifecycleBar({
  judgment,
  contentDirty,
}: {
  judgment: { id: string; status: string };
  /** True while the Content editor below has unsaved text — see ContentCard's doc comment for why this is lifted up here. */
  contentDirty: boolean;
}) {
  const navigate = useNavigate();
  const finalize = useFinalizeJudgment(judgment.id);
  const unlock = useUnlockJudgment(judgment.id);
  const del = useDeleteJudgment();
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isDraft = judgment.status === "draft";

  return (
    <div className="sticky top-[68px] z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-[#141414] p-3 shadow-[0_8px_24px_rgba(0,0,0,0.55)]">
      {isDraft ? (
        <>
          <Button
            size="sm"
            disabled={contentDirty}
            onClick={() => setConfirmFinalize(true)}
            title={contentDirty ? "Save your content first. See the Content card below." : undefined}
          >
            <Lock className="h-4 w-4" />
            Finalize
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-4 w-4" />
            Delete draft
          </Button>
          <p className="text-xs text-muted-foreground">
            {contentDirty
              ? "You have unsaved Content changes. Click \"Save content\" below before finalizing, or they'll be lost."
              : "Draft: all fields are editable. Finalizing locks the substantive fields until you Unlock the judgment to make corrections."}
          </p>
        </>
      ) : (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => unlock.mutate()}
            disabled={unlock.isPending}
          >
            {unlock.isPending ? <LoadingSpinner size={14} /> : <LockOpen className="h-4 w-4" />}
            Unlock
          </Button>
          <p className="text-xs text-muted-foreground">
            Final: substantive fields are locked. Unlock returns this
            judgment to an editable draft so you can make corrections, then
            finalize it again when ready.
          </p>
        </>
      )}

      <AlertDialog
        open={confirmFinalize}
        onOpenChange={setConfirmFinalize}
        title="Finalize this judgment?"
        description="Title, case number, court, date, citation, and content will be locked until you Unlock the judgment to make corrections."
        confirmLabel="Finalize"
        confirmVariant="default"
        isConfirming={finalize.isPending}
        onConfirm={() =>
          finalize.mutate(undefined, { onSuccess: () => setConfirmFinalize(false) })
        }
      />
      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this draft?"
        description="This permanently deletes the draft judgment. This cannot be undone."
        confirmLabel="Delete"
        isConfirming={del.isPending}
        onConfirm={() =>
          del.mutate(judgment.id, {
            onSuccess: () => navigate(ROUTES.judgments),
          })
        }
      />
    </div>
  );
}

function FieldsCard({
  judgment,
  isDraft,
}: {
  judgment: {
    id: string;
    title: string;
    case_number: string | null;
    court_name: string | null;
    judgment_date: string | null;
    citation: string | null;
  };
  isDraft: boolean;
}) {
  const updateFields = useUpdateJudgmentFields(judgment.id);
  const form = useForm<JudgmentFieldsFormValues>({
    resolver: zodResolver(judgmentFieldsSchema),
    values: {
      title: judgment.title,
      case_number: judgment.case_number ?? "",
      court_name: judgment.court_name ?? "",
      judgment_date: judgment.judgment_date ?? "",
      citation: judgment.citation ?? "",
    },
  });

  async function onSubmit(values: JudgmentFieldsFormValues) {
    try {
      await updateFields.mutateAsync({
        title: values.title,
        case_number: values.case_number || null,
        court_name: values.court_name || null,
        judgment_date: values.judgment_date || null,
        citation: values.citation || null,
      });
    } catch {
      // Surfaced globally via the mutation cache toast subscriber.
    }
  }

  // Final: a genuine plain-text read view, not a form of disabled input
  // boxes — a disabled <Input> still LOOKS like an edit form at a glance.
  // Matches the Case Law canonical detail page's same fix: viewing a
  // locked record should never look like you've landed in an editor.
  // "Unlock" (LifecycleBar, above) is the deliberate action that reopens
  // this exact form for editing — mirroring Case Law's admin "Edit"
  // button reopening the record for review.
  if (!isDraft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <span className="font-medium text-foreground">Case number: </span>
            <span className="text-muted-foreground">{judgment.case_number || "—"}</span>
          </p>
          <p>
            <span className="font-medium text-foreground">Court: </span>
            <span className="text-muted-foreground">{judgment.court_name || "—"}</span>
          </p>
          <p>
            <span className="font-medium text-foreground">Judgment date: </span>
            <span className="text-muted-foreground">
              {judgment.judgment_date ? formatDate(judgment.judgment_date) : "—"}
            </span>
          </p>
          <p>
            <span className="font-medium text-foreground">Citation: </span>
            <span className="text-muted-foreground">{judgment.citation || "—"}</span>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Details</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={!isDraft} />
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
                    <FormLabel>Case number</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={!isDraft} />
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
                    <FormLabel>Judgment date</FormLabel>
                    <FormControl>
                      <DateOnlyInput
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        disabled={!isDraft}
                        aria-label="Judgment date"
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
                name="court_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Court name</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={!isDraft} />
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
                    <FormLabel>Citation</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={!isDraft} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            {isDraft && (
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={updateFields.isPending}>
                  {updateFields.isPending && <LoadingSpinner className="text-current" size={14} />}
                  Save details
                </Button>
              </div>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function DiscoverabilityCard({
  judgment,
}: {
  judgment: { id: string; is_discoverable: boolean };
}) {
  const setDiscoverable = useSetJudgmentDiscoverable(judgment.id);
  return (
    <Card>
      <CardContent className="p-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={judgment.is_discoverable}
            onCheckedChange={(checked) => setDiscoverable.mutate(checked)}
            disabled={setDiscoverable.isPending}
          />
          <span className="text-foreground">Discoverable to other magistrates</span>
        </label>
      </CardContent>
    </Card>
  );
}

/**
 * Category + Tags together — "what offence/matter does this judgment
 * concern," at a glance. Both are independent of draft/final status
 * (0075/0028 — neither is one of the seven substantive fields
 * protect_judgment_lifecycle() locks), so this stays editable even on a
 * finalized judgment. "Generate from document" re-runs the same automatic
 * extraction+proposal that now also runs right after every new upload —
 * exposed here too so it can be used on a document that was attached
 * before this feature existed.
 */
function ClassificationCard({
  judgmentId,
  categoryId,
  onGenerateFromDocument,
  isGenerating,
}: {
  judgmentId: string;
  categoryId: string | null;
  onGenerateFromDocument: () => void;
  isGenerating: boolean;
}) {
  const { data } = useJudgmentTags(judgmentId);
  const addTag = useAddJudgmentTag(judgmentId);
  const removeTag = useRemoveJudgmentTag(judgmentId);
  const setCategory = useSetJudgmentCategory(judgmentId);
  const { data: categories } = useLegalCaseCategories();
  const [value, setValue] = useState("");
  // Defaults to a plain read view, same as Case Law's canonical detail
  // page — Category/Tags are DB-writable regardless of draft/final
  // status (0075/0028), but that must never mean the card LOOKS like an
  // active edit form the moment you open the judgment. An explicit click
  // reveals the editable controls, mirroring the "Edit" action Case Law
  // uses, just as a local toggle here since there's no separate review
  // surface for a magistrate's own Judgment the way there is for shared
  // Case Law.
  const [isEditing, setIsEditing] = useState(false);
  const categoryName = (categories ?? []).find((c) => c.id === categoryId)?.name;

  if (!isEditing) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Classification</CardTitle>
          <Button type="button" size="sm" variant="ghost" onClick={() => setIsEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <span className="font-medium text-foreground">Category: </span>
            <span className="text-muted-foreground">{categoryName || "—"}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {data?.map((tag) => (
              <Badge key={tag.id} variant="secondary">
                {tag.tag_name}
              </Badge>
            ))}
            {data?.length === 0 && <p className="text-sm text-muted-foreground">No tags yet.</p>}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Classification</CardTitle>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isGenerating}
            onClick={onGenerateFromDocument}
          >
            {isGenerating ? <LoadingSpinner size={14} /> : <Sparkles className="h-3.5 w-3.5" />}
            Generate from document
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
            Done
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <CategoryField
          value={categoryId}
          onChange={(id) => setCategory.mutate(id)}
          categories={categories ?? []}
          hint="What offence/matter this judgment concerns."
        />
        <div className="space-y-2">
          <label className="block text-xs font-medium text-muted-foreground">Tags</label>
          <div className="flex gap-2">
            <TagInput
              value={value}
              onChange={setValue}
              onSubmit={() => {
                if (value.trim()) {
                  addTag.mutate(value.trim(), { onSuccess: () => setValue("") });
                }
              }}
              disabled={addTag.isPending}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {data?.map((tag) => (
              <Badge key={tag.id} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1">
                {tag.tag_name}
                <button
                  type="button"
                  onClick={() => removeTag.mutate(tag.id)}
                  className="rounded-full p-0.5 hover:bg-background/60"
                  aria-label={`Remove tag ${tag.tag_name}`}
                >
                  ×
                </button>
              </Badge>
            ))}
            {data?.length === 0 && (
              <p className="text-sm text-muted-foreground">No tags yet.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Content is the ONE thing on this page that must never silently vanish.
 * `dirty` is reported up to the parent (`onDirtyChange`) so `LifecycleBar`
 * — a completely separate sibling component that previously had no idea
 * this editor had unsaved text — can refuse to Finalize while there's
 * anything unsaved, instead of the two acting independently and Finalize
 * discarding it without warning (the exact bug that lost a real,
 * already-typed judgment: typing was never sent to the server at all,
 * confirmed via audit_log showing content_text empty since the row's very
 * first insert — there was nothing to silently overwrite, it just never
 * left the browser). A native beforeunload prompt is the second half of
 * the same fix — refreshing or closing the tab mid-edit must warn too.
 */
function ContentCard({
  judgment,
  isDraft,
  onDirtyChange,
}: {
  judgment: { id: string; content: unknown; content_text: string | null };
  isDraft: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const updateContent = useUpdateJudgmentContent(judgment.id);
  const [pending, setPending] = useState<{ json: JSONContent; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDirty(false);
    setPending(null);
    onDirtyChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDirtyChange is a stable setState wrapper from the parent, not a reactive dependency
  }, [judgment.id, isDraft]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function markDirty(next: boolean) {
    setDirty(next);
    onDirtyChange(next);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Content</CardTitle>
        {isDraft && dirty && (
          <div className="flex items-center gap-2">
            <p className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</p>
            <Button
              size="sm"
              disabled={updateContent.isPending}
              onClick={() => {
                if (!pending) return;
                updateContent.mutate(
                  { content: pending.json, content_text: pending.text },
                  { onSuccess: () => markDirty(false) },
                );
              }}
            >
              {updateContent.isPending && <LoadingSpinner className="text-current" size={14} />}
              <CheckCircle2 className="h-4 w-4" />
              Save content
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <RichTextEditor
          key={judgment.id + String(isDraft)}
          content={(judgment.content as JSONContent | null) ?? null}
          editable={isDraft}
          placeholder="Write the judgment…"
          onChange={(json, text) => {
            setPending({ json, text });
            markDirty(true);
          }}
        />
        {!isDraft && !judgment.content_text?.trim() && (
          <p className="text-sm italic text-muted-foreground">No content on record.</p>
        )}
      </CardContent>
    </Card>
  );
}

function LinksPanel({ judgmentId }: { judgmentId: string }) {
  const { data: matters, isPending: mattersPending } = useJudgmentDocketMatters(judgmentId);
  const { data: quickCodes, isPending: qcPending } = useJudgmentQuickCodes(judgmentId);

  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Linked Docket Matters</CardTitle>
        </CardHeader>
        <CardContent>
          {mattersPending ? (
            <Skeleton className="h-16 w-full" />
          ) : !matters || matters.length === 0 ? (
            <EmptyState
              className="border-0 py-4"
              title="No linked matters"
              description="Link this judgment from the Docket workspace."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {matters.map((m) => (
                <li key={m.id}>
                  {m.docket_matters ? (
                    <span>
                      <span className="font-medium text-foreground">
                        {m.docket_matters.matter_title}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        ({m.docket_matters.case_number})
                      </span>
                    </span>
                  ) : (
                    <span className="italic text-muted-foreground">
                      Matter unavailable
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Quick Codes</CardTitle>
        </CardHeader>
        <CardContent>
          {qcPending ? (
            <Skeleton className="h-16 w-full" />
          ) : !quickCodes || quickCodes.length === 0 ? (
            <EmptyState
              className="border-0 py-4"
              title="No associated Quick Codes"
              description="Associate a Quick Code from your Quick Codes workspace."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {quickCodes.map((qc) => (
                <li key={qc.id}>
                  {qc.quick_codes ? (
                    <span className="font-mono text-foreground">
                      {qc.quick_codes.code_word}
                    </span>
                  ) : (
                    <span className="italic text-muted-foreground">Unavailable</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
