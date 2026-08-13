import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Lock, LockOpen, Trash2, CheckCircle2 } from "lucide-react";
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
import {
  useDeleteJudgment,
  useFinalizeJudgment,
  useJudgment,
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
import {
  judgmentFieldsSchema,
  type JudgmentFieldsFormValues,
} from "@/lib/validations/judgment";
import { formatDateTime, toTitleCase } from "@/lib/utils";
import { ROUTES } from "@/routes/paths";
import { useBackNav } from "@/hooks/use-back-nav";
import { Billboard } from "@/components/browse";

export default function JudgmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const back = useBackNav(ROUTES.judgments, "Back to Judgments");
  const { data: judgment, isPending, isError, error, refetch } = useJudgment(id);

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
          <BookmarkToggle entityType="judgment" entityId={judgment.id} />
        </div>

      <LifecycleBar judgment={judgment} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <FieldsCard judgment={judgment} isDraft={isDraft} />
        </div>
        <div className="space-y-4">
          <DiscoverabilityCard judgment={judgment} />
          <TagsCard judgmentId={judgment.id} />
        </div>
      </div>

      <ContentCard judgment={judgment} isDraft={isDraft} />

      <Tabs defaultValue="links">
        <TabsList>
          <TabsTrigger value="links">Links</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>
        <TabsContent value="links">
          <LinksPanel judgmentId={judgment.id} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsPanel entityType="judgment" entityId={judgment.id} />
        </TabsContent>
      </Tabs>
    </div>
    </>
  );
}

function LifecycleBar({
  judgment,
}: {
  judgment: { id: string; status: string };
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
          <Button size="sm" onClick={() => setConfirmFinalize(true)}>
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
            Draft — all fields are editable. Finalizing locks the substantive
            fields until you Unlock the judgment to make corrections.
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
            Final — substantive fields are locked. Unlock returns this
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
      <CardHeader>
        <CardTitle className="text-base">Discoverability</CardTitle>
      </CardHeader>
      <CardContent>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox
            checked={judgment.is_discoverable}
            onCheckedChange={(checked) => setDiscoverable.mutate(checked)}
            disabled={setDiscoverable.isPending}
          />
          <span>
            <span className="font-medium text-foreground">
              Discoverable to other magistrates
            </span>
            <br />
            <span className="text-muted-foreground">
              Independent of draft/final status — you can toggle this at any
              time.
            </span>
          </span>
        </label>
      </CardContent>
    </Card>
  );
}

function TagsCard({ judgmentId }: { judgmentId: string }) {
  const { data } = useJudgmentTags(judgmentId);
  const addTag = useAddJudgmentTag(judgmentId);
  const removeTag = useRemoveJudgmentTag(judgmentId);
  const [value, setValue] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tags</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
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
      </CardContent>
    </Card>
  );
}

function ContentCard({
  judgment,
  isDraft,
}: {
  judgment: { id: string; content: unknown; content_text: string | null };
  isDraft: boolean;
}) {
  const updateContent = useUpdateJudgmentContent(judgment.id);
  const [pending, setPending] = useState<{ json: JSONContent; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDirty(false);
    setPending(null);
  }, [judgment.id, isDraft]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Content</CardTitle>
        {isDraft && dirty && (
          <Button
            size="sm"
            disabled={updateContent.isPending}
            onClick={() => {
              if (!pending) return;
              updateContent.mutate(
                { content: pending.json, content_text: pending.text },
                { onSuccess: () => setDirty(false) },
              );
            }}
          >
            {updateContent.isPending && <LoadingSpinner className="text-current" size={14} />}
            <CheckCircle2 className="h-4 w-4" />
            Save content
          </Button>
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
            setDirty(true);
          }}
        />
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
