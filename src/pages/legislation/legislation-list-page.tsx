import { useMemo, useState } from "react";
import { Plus, ScrollText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { BrowseHeader, BrowsePage, TitleCard, TitleCardSkeletonGallery, TitleGallery } from "@/components/browse";
import { useStatutes } from "@/hooks/legislation/use-legislation";
import { useScopedSearchIds } from "@/hooks/use-scoped-search";
import { useAuth } from "@/hooks/use-auth";
import { CreateLegislationDialog } from "@/pages/legislation/create-legislation-dialog";
import { ROUTES } from "@/routes/paths";
import { formatDate } from "@/lib/utils";

const ALL = "__all__";
type SortKey = "title" | "year" | "recent";

/**
 * Shared Legislation library. Magistrates and admins can publish a new
 * Act from this page (file-first PDF + required metadata). Editing or
 * replacing an existing Act stays on the admin-only edit route.
 *
 * Filters/sort (0098) are all client-side over the existing capped
 * 500-row query, matching this page's existing "no server-side
 * pagination" precedent — library-level metadata search here is
 * deliberately separate from in-document PDF search (see
 * LegislationPdfViewerDialog), which searches the CONTENTS of one
 * already-open document, not this list.
 */
export default function LegislationListPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [jurisdiction, setJurisdiction] = useState(ALL);
  const [documentType, setDocumentType] = useState(ALL);
  const [year, setYear] = useState(ALL);
  const [sort, setSort] = useState<SortKey>("title");
  const { data, isPending, isError, error, refetch } = useStatutes();
  const { hasRole } = useAuth();
  const isAdmin = hasRole("admin");
  const canCreate = hasRole("admin", "magistrate");

  const handleOpenCreate = () => {
    setCreateOpen(true);
  };
  const { data: matchingIds, isPending: searchPending } = useScopedSearchIds(
    "search_statutes",
    query,
  );

  const jurisdictions = useMemo(
    () => Array.from(new Set((data ?? []).map((s) => s.jurisdiction).filter(Boolean))).sort(),
    [data],
  );
  const documentTypes = useMemo(
    () => Array.from(new Set((data ?? []).map((s) => s.instrument_type).filter((v): v is string => !!v))).sort(),
    [data],
  );
  const years = useMemo(
    () =>
      Array.from(new Set((data ?? []).map((s) => s.enactment_year).filter((v): v is number => v != null)))
        .sort((a, b) => b - a),
    [data],
  );

  const rows = useMemo(() => {
    let rows = data ?? [];
    const q = query.trim();
    if (q) rows = rows.filter((s) => matchingIds?.has(s.id) ?? false);
    if (jurisdiction !== ALL) rows = rows.filter((s) => s.jurisdiction === jurisdiction);
    if (documentType !== ALL) rows = rows.filter((s) => s.instrument_type === documentType);
    if (year !== ALL) rows = rows.filter((s) => String(s.enactment_year ?? "") === year);
    const sorted = [...rows];
    if (sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "year") sorted.sort((a, b) => (b.enactment_year ?? 0) - (a.enactment_year ?? 0));
    else sorted.sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
    return sorted;
  }, [data, query, matchingIds, jurisdiction, documentType, year, sort]);

  return (
    <BrowsePage>
      <BrowseHeader
        title="Legislation"
        description="Acts, regulations, and other legal instruments, maintained centrally and available to every magistrate."
        showViewSelect
        action={
          canCreate ? (
            <Button variant="play" onClick={handleOpenCreate}>
              <Plus className="h-4 w-4" />
              Add legislation
            </Button>
          ) : null
        }
      />

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="max-w-sm flex-1 space-y-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search title, code, or text…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search legislation"
            />
          </div>
          {query.trim() && searchPending && (
            <p className="text-xs text-muted-foreground">Searching…</p>
          )}
        </div>

        <Select
          className="max-w-[10rem]"
          aria-label="Filter by jurisdiction"
          value={jurisdiction}
          onChange={(e) => setJurisdiction(e.target.value)}
        >
          <option value={ALL}>All jurisdictions</option>
          {jurisdictions.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </Select>

        <Select
          className="max-w-[10rem]"
          aria-label="Filter by document type"
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value)}
        >
          <option value={ALL}>All types</option>
          {documentTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>

        <Select
          className="max-w-[8rem]"
          aria-label="Filter by year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        >
          <option value={ALL}>All years</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </Select>

        <Select
          className="max-w-[10rem]"
          aria-label="Sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
        >
          <option value="title">Sort: Title</option>
          <option value="year">Sort: Year</option>
          <option value="recent">Sort: Recently added</option>
        </Select>
      </div>

      {isPending ? (
        <TitleCardSkeletonGallery />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={data && data.length > 0 ? "No matches" : "No legislation yet"}
          description={
            data && data.length > 0
              ? "Try different filters or a different search term."
              : "Acts and regulations added to the shared library will appear here."
          }
          action={
            data && data.length === 0 && canCreate ? (
              <Button size="sm" variant="play" onClick={handleOpenCreate}>
                <Plus className="h-4 w-4" />
                Add legislation
              </Button>
            ) : null
          }
        />
      ) : (
        <TitleGallery>
          {rows.map((s) => (
            <TitleCard
              key={s.id}
              tone="legislation"
              eyebrow={s.code}
              title={s.title}
              subtitle={s.jurisdiction}
              badge={s.instrument_type ?? undefined}
              meta={[
                s.effective_date ? `Effective ${formatDate(s.effective_date)}` : null,
                s.page_count ? `${s.page_count} page${s.page_count === 1 ? "" : "s"}` : null,
                // A missing PDF is only ever meaningfully actionable by an
                // admin (upload is admin-only) — an ordinary magistrate
                // never sees an unpublished/incomplete row here at all,
                // per RLS, so this indicator is effectively admin-only in
                // practice even though the check itself is unconditional.
                s.primary_document_id ? null : isAdmin ? "PDF: re-upload needed" : null,
              ].filter((v): v is string => !!v)}
              href={ROUTES.legislationDetail(s.id)}
            />
          ))}
        </TitleGallery>
      )}

      <CreateLegislationDialog open={createOpen} onOpenChange={setCreateOpen} />
    </BrowsePage>
  );
}
