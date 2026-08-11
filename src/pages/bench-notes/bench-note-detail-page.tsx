import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Trash2, CheckCircle2, FileQuestion } from "lucide-react";
import type { JSONContent } from "@tiptap/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/common/inline-error";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { RichTextEditor } from "@/components/common/rich-text-editor";
import { BookmarkToggle } from "@/components/common/bookmark-toggle";
import {
  useBenchNote,
  useDeleteBenchNote,
  useUpdateBenchNoteContent,
  useUpdateBenchNoteFields,
} from "@/hooks/bench-notes/use-bench-notes";
import { useBenchNoteParent } from "@/hooks/bench-notes/use-bench-note-parent";
import { ROUTES } from "@/routes/paths";
import { toTitleCase } from "@/lib/utils";

const PARENT_TYPE_LABELS: Record<string, string> = {
  docket_matter: "Docket Matter",
  judgment: "Judgment",
  case_law: "Case Law",
};

const PARENT_ROUTE: Record<string, (id: string) => string> = {
  docket_matter: ROUTES.docketMatter,
  judgment: ROUTES.judgmentDetail,
  case_law: ROUTES.caseLawDetail,
};

export default function BenchNoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: note, isPending, isError, error, refetch } = useBenchNote(id);
  const deleteBenchNote = useDeleteBenchNote();
  const updateFields = useUpdateBenchNoteFields(id ?? "");
  const updateContent = useUpdateBenchNoteContent(id ?? "");
  const { data: parent, isPending: parentPending } = useBenchNoteParent(
    note?.entity_type,
    note?.entity_id,
  );

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState("");
  const [pendingContent, setPendingContent] = useState<{ json: JSONContent; text: string } | null>(
    null,
  );
  const [contentDirty, setContentDirty] = useState(false);

  // Intentionally re-syncs only when switching to a different note (by id),
  // not on every background refetch of the same note — otherwise an
  // in-flight refetch could stomp the title the user is actively editing.
  useEffect(() => {
    if (note) setTitle(note.title);
    setContentDirty(false);
    setPendingContent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError) return <InlineError error={error} onRetry={() => void refetch()} />;
  if (!note) {
    return (
      <InlineError
        error={new Error("This note doesn't exist, or you don't have access to it.")}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2"
          onClick={() => navigate(ROUTES.benchNotes)}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Bench Notes
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{note.title}</h1>
          <Badge variant={note.status === "published" ? "default" : "secondary"}>
            {toTitleCase(note.status)}
          </Badge>
          <BookmarkToggle entityType="bench_note" entityId={note.id} />
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          About:{" "}
          {parentPending ? (
            "Loading…"
          ) : parent ? (
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => navigate(PARENT_ROUTE[note.entity_type]?.(note.entity_id) ?? "#")}
            >
              {parent.label}
              {parent.subtitle ? ` · ${parent.subtitle}` : ""}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 italic">
              <FileQuestion className="h-3.5 w-3.5" />
              Parent unavailable ({PARENT_TYPE_LABELS[note.entity_type] ?? note.entity_type})
            </span>
          )}
        </div>
      </div>

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
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Title</label>
              <div className="flex gap-2">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
                {title !== note.title && title.trim() && (
                  <Button
                    size="sm"
                    disabled={updateFields.isPending}
                    onClick={() => updateFields.mutate({ title: title.trim() })}
                  >
                    Save
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Status</label>
              <Select
                value={note.status}
                onChange={(e) =>
                  updateFields.mutate({ status: e.target.value as "draft" | "published" })
                }
                disabled={updateFields.isPending}
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </Select>
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox
              checked={note.is_private}
              onCheckedChange={(checked) => updateFields.mutate({ is_private: checked })}
              disabled={updateFields.isPending}
            />
            <span>
              <span className="font-medium text-foreground">Mark as private</span>
              <br />
              <span className="text-muted-foreground">
                For your own organization only — Bench Notes are always
                restricted to you regardless of this setting; no other user
                can ever see this note.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Content</CardTitle>
          {contentDirty && (
            <Button
              size="sm"
              disabled={updateContent.isPending}
              onClick={() => {
                if (!pendingContent) return;
                updateContent.mutate(
                  { content: pendingContent.json, content_text: pendingContent.text },
                  { onSuccess: () => setContentDirty(false) },
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
            key={note.id}
            content={(note.content as JSONContent | null) ?? null}
            placeholder="Write your note…"
            onChange={(json, text) => {
              setPendingContent({ json, text });
              setContentDirty(true);
            }}
          />
        </CardContent>
      </Card>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this Bench Note?"
        description="This permanently deletes the note. This cannot be undone."
        confirmLabel="Delete"
        isConfirming={deleteBenchNote.isPending}
        onConfirm={() =>
          deleteBenchNote.mutate(note.id, { onSuccess: () => navigate(ROUTES.benchNotes) })
        }
      />
    </div>
  );
}
