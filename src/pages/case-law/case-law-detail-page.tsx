import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { ArrowLeft, ExternalLink, Trash2, StickyNote, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { DocumentsPanel } from "@/components/common/documents-panel";
import { BookmarkToggle } from "@/components/common/bookmark-toggle";
import { useAuth } from "@/hooks/use-auth";
import {
  useCaseLawItem,
  useDeleteCaseLaw,
  useSetCaseLawDiscoverable,
  useUpdateCaseLawFields,
} from "@/hooks/case-law/use-case-law";
import { useCaseLawTags } from "@/hooks/case-law/use-case-law-tags";
import {
  useCaseLawAnnotations,
  useCreateCaseLawAnnotation,
  useDeleteCaseLawAnnotation,
  useUpdateCaseLawAnnotation,
} from "@/hooks/case-law/use-case-law-annotations";
import {
  caseLawFieldsSchema,
  type CaseLawFieldsFormValues,
} from "@/lib/validations/case-law";
import { formatDate, formatDateTime } from "@/lib/utils";
import { ROUTES } from "@/routes/paths";

export default function CaseLawDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: caseLaw, isPending, isError, error, refetch } = useCaseLawItem(id);
  const deleteCaseLaw = useDeleteCaseLaw();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError) return <InlineError error={error} onRetry={() => void refetch()} />;
  if (!caseLaw) {
    return (
      <InlineError
        error={new Error("This entry doesn't exist, or you don't have access to it.")}
      />
    );
  }

  const isCanonical = caseLaw.owner_id === null;
  const isOwner = caseLaw.owner_id === user?.id;
  const isEditable = isOwner; // Canonical edits are Admin-only; no frontend bypass here.

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2"
          onClick={() => navigate(ROUTES.caseLaw)}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Case Law
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {caseLaw.case_name}
          </h1>
          <Badge variant={isCanonical ? "outline" : "secondary"}>
            {isCanonical ? "Canonical" : isOwner ? "My research" : "Discoverable"}
          </Badge>
          <BookmarkToggle entityType="case_law" entityId={caseLaw.id} />
        </div>
        <p className="text-sm text-muted-foreground">
          {caseLaw.citation} · {caseLaw.court}
          {caseLaw.jurisdiction ? ` · ${caseLaw.jurisdiction}` : ""}
        </p>
      </div>

      {isOwner && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
          <p className="text-xs text-muted-foreground">
            This permanently deletes your research entry, including its
            annotations.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <FieldsCard caseLaw={caseLaw} isEditable={isEditable} />
        </div>
        <div className="space-y-4">
          {isOwner && <DiscoverabilityCard caseLaw={caseLaw} />}
          <TagsCard caseLawId={caseLaw.id} />
        </div>
      </div>

      <Tabs defaultValue="annotations">
        <TabsList>
          <TabsTrigger value="annotations">My Annotations</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>
        <TabsContent value="annotations">
          <AnnotationsPanel caseLawId={caseLaw.id} />
        </TabsContent>
        <TabsContent value="documents">
          {/* Attaching to canonical Case Law is Admin-only per the live
              documents INSERT policy (can_edit_case_law) — hide Upload
              rather than show a control that will always be RLS-denied
              for an ordinary magistrate viewing canonical/discoverable
              research they don't own. */}
          <DocumentsPanel entityType="case_law" entityId={caseLaw.id} canUpload={isOwner} />
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this research entry?"
        description="This permanently deletes the entry and your annotations on it. This cannot be undone."
        confirmLabel="Delete"
        isConfirming={deleteCaseLaw.isPending}
        onConfirm={() =>
          deleteCaseLaw.mutate(caseLaw.id, {
            onSuccess: () => navigate(ROUTES.caseLaw),
          })
        }
      />
    </div>
  );
}

interface CaseLawDetail {
  id: string;
  case_name: string;
  citation: string;
  court: string;
  jurisdiction: string;
  decided_date: string | null;
  source_url: string | null;
  summary: string | null;
  full_text: string | null;
  is_discoverable: boolean;
}

function FieldsCard({
  caseLaw,
  isEditable,
}: {
  caseLaw: CaseLawDetail;
  isEditable: boolean;
}) {
  const updateFields = useUpdateCaseLawFields(caseLaw.id);
  const form = useForm<CaseLawFieldsFormValues>({
    resolver: zodResolver(caseLawFieldsSchema),
    values: {
      case_name: caseLaw.case_name,
      citation: caseLaw.citation,
      court: caseLaw.court,
      jurisdiction: caseLaw.jurisdiction,
      decided_date: caseLaw.decided_date ?? "",
      source_url: caseLaw.source_url ?? "",
      summary: caseLaw.summary ?? "",
      full_text: caseLaw.full_text ?? "",
    },
  });

  async function onSubmit(values: CaseLawFieldsFormValues) {
    try {
      await updateFields.mutateAsync({
        case_name: values.case_name,
        citation: values.citation,
        court: values.court,
        jurisdiction: values.jurisdiction,
        decided_date: values.decided_date || null,
        source_url: values.source_url || null,
        summary: values.summary || null,
        full_text: values.full_text || null,
      });
    } catch {
      // Surfaced globally via the mutation cache toast subscriber.
    }
  }

  if (!isEditable) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {caseLaw.decided_date && (
            <p>
              <span className="font-medium text-foreground">Decided: </span>
              <span className="text-muted-foreground">{formatDate(caseLaw.decided_date)}</span>
            </p>
          )}
          {caseLaw.source_url && (
            <p>
              <a
                href={caseLaw.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Source <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </p>
          )}
          {caseLaw.summary && (
            <div>
              <p className="mb-1 font-medium text-foreground">Summary</p>
              <p className="whitespace-pre-wrap text-muted-foreground">{caseLaw.summary}</p>
            </div>
          )}
          {caseLaw.full_text && (
            <div>
              <p className="mb-1 font-medium text-foreground">Full text</p>
              <p className="whitespace-pre-wrap text-muted-foreground">{caseLaw.full_text}</p>
            </div>
          )}
          {!caseLaw.summary && !caseLaw.full_text && (
            <p className="text-muted-foreground">No summary or full text on record.</p>
          )}
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
              name="case_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Case name</FormLabel>
                  <FormControl>
                    <Input {...field} />
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
                    <FormLabel>Decided date</FormLabel>
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
                  <FormLabel>Source URL</FormLabel>
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
                  <FormLabel>Summary</FormLabel>
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
                  <FormLabel>Full text</FormLabel>
                  <FormControl>
                    <Textarea rows={8} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={updateFields.isPending}>
                {updateFields.isPending && <LoadingSpinner className="text-current" size={14} />}
                Save
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function DiscoverabilityCard({ caseLaw }: { caseLaw: { id: string; is_discoverable: boolean } }) {
  const setDiscoverable = useSetCaseLawDiscoverable(caseLaw.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Discoverability</CardTitle>
      </CardHeader>
      <CardContent>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox
            checked={caseLaw.is_discoverable}
            onCheckedChange={(checked) => setDiscoverable.mutate(checked)}
            disabled={setDiscoverable.isPending}
          />
          <span>
            <span className="font-medium text-foreground">
              Discoverable to other magistrates
            </span>
            <br />
            <span className="text-muted-foreground">
              Other magistrates will be able to see this research entry
              (but never your private annotations on it).
            </span>
          </span>
        </label>
      </CardContent>
    </Card>
  );
}

function TagsCard({ caseLawId }: { caseLawId: string }) {
  const { data } = useCaseLawTags(caseLawId);
  if (!data || data.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tags</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {data.map((row) =>
          row.tags ? (
            <Badge key={row.tags.id} variant="secondary">
              {row.tags.name}
            </Badge>
          ) : null,
        )}
      </CardContent>
    </Card>
  );
}

function AnnotationsPanel({ caseLawId }: { caseLawId: string }) {
  const { data, isPending, isError, error, refetch } = useCaseLawAnnotations(caseLawId);
  const createAnnotation = useCreateCaseLawAnnotation(caseLawId);
  const updateAnnotation = useUpdateCaseLawAnnotation(caseLawId);
  const deleteAnnotation = useDeleteCaseLawAnnotation(caseLawId);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  return (
    <div className="mt-4 space-y-4">
      <p className="text-xs text-muted-foreground">
        Private to you — no other user can see these, even on canonical or
        discoverable Case Law.
      </p>
      <Card>
        <CardContent className="space-y-2 p-4">
          <Textarea
            placeholder="Add a private annotation…"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!draft.trim() || createAnnotation.isPending}
              onClick={() =>
                createAnnotation.mutate(draft.trim(), { onSuccess: () => setDraft("") })
              }
            >
              {createAnnotation.isPending && <LoadingSpinner className="text-current" size={14} />}
              Add annotation
            </Button>
          </div>
        </CardContent>
      </Card>

      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title="No annotations yet"
          description="Add private notes to yourself about this case law."
        />
      ) : (
        <div className="space-y-3">
          {data.map((a) => (
            <Card key={a.id}>
              <CardContent className="p-4">
                {editingId === a.id ? (
                  <div className="space-y-2">
                    <Textarea
                      rows={3}
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                    />
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={!editingText.trim() || updateAnnotation.isPending}
                        onClick={() =>
                          updateAnnotation.mutate(
                            { id: a.id, annotation_text: editingText.trim() },
                            { onSuccess: () => setEditingId(null) },
                          )
                        }
                      >
                        {updateAnnotation.isPending && (
                          <LoadingSpinner className="text-current" size={14} />
                        )}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="whitespace-pre-wrap text-sm text-foreground">
                        {a.annotation_text}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(a.updated_at)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Edit annotation"
                        onClick={() => {
                          setEditingId(a.id);
                          setEditingText(a.annotation_text);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Delete annotation"
                        onClick={() => setPendingDelete(a.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this annotation?"
        description="This cannot be undone."
        confirmLabel="Delete"
        isConfirming={deleteAnnotation.isPending}
        onConfirm={() => {
          if (pendingDelete) {
            deleteAnnotation.mutate(pendingDelete, { onSuccess: () => setPendingDelete(null) });
          }
        }}
      />
    </div>
  );
}
