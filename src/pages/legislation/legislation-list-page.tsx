import { useMemo, useState } from "react";
import { ScrollText, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { BrowseHeader, BrowsePage, TitleCard, TitleCardSkeletonGallery, TitleGallery } from "@/components/browse";
import { useStatutes } from "@/hooks/legislation/use-legislation";
import { useScopedSearchIds } from "@/hooks/use-scoped-search";
import { ROUTES } from "@/routes/paths";
import { formatDate } from "@/lib/utils";

/**
 * Legislation is institutional/canonical reference content, maintained
 * centrally (admin-only write, per `statutes`' own RLS) — unlike Case
 * Law or Judgments, there is no "My Legislation" tab and no per-user
 * creation here. See use-legislation.ts for what this reuses vs defers.
 */
export default function LegislationListPage() {
  const [query, setQuery] = useState("");
  const { data, isPending, isError, error, refetch } = useStatutes();
  const { data: matchingIds, isPending: searchPending } = useScopedSearchIds(
    "search_statutes",
    query,
  );

  const rows = useMemo(() => {
    const all = data ?? [];
    const q = query.trim();
    if (!q) return all;
    return all.filter((s) => matchingIds?.has(s.id) ?? false);
  }, [data, query, matchingIds]);

  return (
    <BrowsePage>
      <BrowseHeader
        title="Legislation"
        description="Acts, regulations, and other legal instruments — maintained centrally and available to every magistrate."
        showViewSelect
      />

      <div className="mb-8 max-w-sm space-y-1">
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
              ? "Try a different search term."
              : "Acts and regulations added to the shared library will appear here."
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
              meta={s.effective_date ? [`Effective ${formatDate(s.effective_date)}`] : undefined}
              href={ROUTES.legislationDetail(s.id)}
            />
          ))}
        </TitleGallery>
      )}
    </BrowsePage>
  );
}
