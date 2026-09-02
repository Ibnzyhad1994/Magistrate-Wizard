import { useMemo, useState } from "react";
import { Plus, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { BrowseHeader, BrowsePage, TitleCard, TitleCardSkeletonGallery, TitleGallery } from "@/components/browse";
import { useBenchNotes } from "@/hooks/bench-notes/use-bench-notes";
import { useScopedSearchIds } from "@/hooks/use-scoped-search";
import { CreateBenchNoteDialog } from "@/pages/bench-notes/create-bench-note-dialog";
import { ROUTES } from "@/routes/paths";
import { formatDate, toTitleCase } from "@/lib/utils";

const PARENT_TYPE_LABELS: Record<string, string> = {
  docket_matter: "Docket Matter",
  judgment: "Judgment",
  case_law: "Case Law",
  statute: "Legislation",
};

export default function BenchNotesListPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const { data, isPending, isError, error, refetch } = useBenchNotes();

  // Searches title AND note content (bench_notes.search_vector covers
  // both, see 0004/0010) — previously this page only matched on title
  // client-side despite the backing full-text index already being richer.
  const { data: matchingIds, isPending: searchPending } = useScopedSearchIds(
    "search_bench_notes",
    query,
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    return (data ?? []).filter((n) => {
      if (q && !(matchingIds?.has(n.id) ?? false)) return false;
      if (statusFilter && n.status !== statusFilter) return false;
      if (entityFilter && n.entity_type !== entityFilter) return false;
      return true;
    });
  }, [data, query, matchingIds, statusFilter, entityFilter]);

  const entityTypesInUse = useMemo(
    () => Array.from(new Set((data ?? []).map((n) => n.entity_type))).sort(),
    [data],
  );

  return (
    <BrowsePage>
      <BrowseHeader
        title="Bench Notes"
        description="Your notes, attached to Docket Matters, Judgments, Case Law, or Legislation."
        showViewSelect
        dataTour="page-bench-notes"
        action={
          <Button variant="play" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New Bench Note
          </Button>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          className="max-w-sm"
          placeholder="Search title and note content…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search Bench Notes"
        />
        <Select
          className="w-full sm:w-40"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </Select>
        {entityTypesInUse.length > 1 && (
          <Select
            className="w-full sm:w-48"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            aria-label="Filter by associated content type"
          >
            <option value="">All associated content</option>
            {entityTypesInUse.map((t) => (
              <option key={t} value={t}>
                {PARENT_TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </Select>
        )}
      </div>

      {isPending || (query.trim() && searchPending) ? (
        <div className="mt-8">
          <TitleCardSkeletonGallery />
        </div>
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          className="mt-8"
          title={data && data.length > 0 ? "No matches" : "No Bench Notes yet"}
          description={
            data && data.length > 0
              ? "Try a different search term or clear a filter."
              : "Attach a note to a matter, judgment, case law entry, or Act to see it here."
          }
          action={
            <Button size="sm" variant="play" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New Bench Note
            </Button>
          }
        />
      ) : (
        <TitleGallery>
          {filtered.map((note) => (
            <TitleCard
              key={note.id}
              tone="note"
              eyebrow={PARENT_TYPE_LABELS[note.entity_type] ?? note.entity_type}
              title={note.title}
              badge={toTitleCase(note.status)}
              meta={[formatDate(note.updated_at)]}
              href={ROUTES.benchNoteDetail(note.id)}
            />
          ))}
        </TitleGallery>
      )}

      <CreateBenchNoteDialog open={createOpen} onOpenChange={setCreateOpen} />
    </BrowsePage>
  );
}
