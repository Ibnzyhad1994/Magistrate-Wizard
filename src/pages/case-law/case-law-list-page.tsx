import { useMemo, useState } from "react";
import { Plus, BookOpen, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { BrowseHeader, BrowsePage, TitleCard, TitleGallery } from "@/components/browse";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { useAuth } from "@/hooks/use-auth";
import { useCaseLawList, useCaseLawScopedSearch } from "@/hooks/case-law/use-case-law";
import { useScopedSearchIds } from "@/hooks/use-scoped-search";
import {
  useLegalJurisdictions,
  useLegalAuthorityCourts,
  useCaseLawCountsByCourt,
  useCaseLawCountsByJurisdiction,
} from "@/hooks/legal-library/use-legal-taxonomy";
import { CreateCaseLawDialog } from "@/pages/case-law/create-case-law-dialog";
import { ROUTES } from "@/routes/paths";

export default function CaseLawListPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [courtId, setCourtId] = useState<string | null>(null);
  const [jurisdictionId, setJurisdictionId] = useState<string | null>(null);
  const { user } = useAuth();
  const { data, isPending, isError, error, refetch } = useCaseLawList();
  const { data: jurisdictions } = useLegalJurisdictions();
  const { data: courts } = useLegalAuthorityCourts();
  const { data: courtCounts } = useCaseLawCountsByCourt();
  const { data: jurisdictionCounts } = useCaseLawCountsByJurisdiction();

  // Real full-text search over Case Law's own search_vector — used for the
  // My Research / Discoverable tabs (personal rows have no Court/
  // Jurisdiction relationship to scope by). The Canonical tab instead uses
  // the Court/Jurisdiction/Tag-scoped RPC below once any filter is active,
  // per §12/§25 ("Case Law → Privy Council" scopes results, then a search
  // within that scope stays scoped — filtering happens in the database,
  // not by fetching everything and filtering in the browser).
  const { data: matchingIds, isPending: searchPending } = useScopedSearchIds(
    "search_case_law",
    query,
  );

  const scopeActive = !!courtId || !!jurisdictionId || !!query.trim();
  const { data: scopedResults, isPending: scopedPending } = useCaseLawScopedSearch({
    query,
    courtId,
    jurisdictionId,
    tagId: null,
  });

  const { canonical, mine, discoverable } = useMemo(() => {
    const all = data ?? [];
    const q = query.trim();
    const matches = (row: (typeof all)[number]) => !q || (matchingIds?.has(row.id) ?? false);
    return {
      canonical: all.filter((c) => c.owner_id === null && matches(c)),
      mine: all.filter((c) => c.owner_id === user?.id && matches(c)),
      discoverable: all.filter(
        (c) => c.owner_id !== null && c.owner_id !== user?.id && c.is_discoverable && matches(c),
      ),
    };
  }, [data, user?.id, query, matchingIds]);

  const canonicalRows =
    scopeActive && (courtId || jurisdictionId)
      ? (scopedResults ?? []).map((r) => ({
          id: r.id,
          case_name: r.case_name,
          citation: r.citation,
          court: r.court,
          jurisdiction: r.jurisdiction,
          owner_id: null,
          updated_at: null,
        }))
      : canonical;

  return (
    <BrowsePage>
      <BrowseHeader
        title="Case Law"
        description="Canonical authorities, your personal research, and research other magistrates have made discoverable."
        showViewSelect
        action={
          <Button variant="play" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New research entry
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="max-w-sm flex-1 space-y-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search case name, citation, court, or text…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search case law"
            />
          </div>
          {query.trim() && (searchPending || scopedPending) && (
            <p className="text-xs text-muted-foreground">Searching…</p>
          )}
        </div>
        <Select
          className="max-w-[220px]"
          value={jurisdictionId ?? ""}
          onChange={(e) => setJurisdictionId(e.target.value || null)}
          aria-label="Filter by Jurisdiction"
        >
          <option value="">All Jurisdictions</option>
          {(jurisdictions ?? []).map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}
              {jurisdictionCounts?.get(j.id) ? ` (${jurisdictionCounts.get(j.id)})` : ""}
            </option>
          ))}
        </Select>
        <Select
          className="max-w-[240px]"
          value={courtId ?? ""}
          onChange={(e) => setCourtId(e.target.value || null)}
          aria-label="Filter by Court"
        >
          <option value="">All Courts</option>
          {(courts ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.canonical_name}
              {courtCounts?.get(c.id) ? ` (${courtCounts.get(c.id)})` : ""}
            </option>
          ))}
        </Select>
        {(courtId || jurisdictionId) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setCourtId(null);
              setJurisdictionId(null);
            }}
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : (
        <Tabs defaultValue="canonical">
          <TabsList>
            <TabsTrigger value="canonical">Canonical ({canonicalRows.length})</TabsTrigger>
            <TabsTrigger value="mine">My Research ({mine.length})</TabsTrigger>
            <TabsTrigger value="discoverable">
              Discoverable ({discoverable.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="canonical">
            <CaseLawTable
              rows={canonicalRows}
              emptyTitle="No canonical authorities match"
              emptyDescription="Canonical Case Law is maintained centrally and will appear here."
            />
          </TabsContent>
          <TabsContent value="mine">
            <CaseLawTable
              rows={mine}
              emptyTitle="No personal research yet"
              emptyDescription="Add a research entry to see it here."
              onCreate={() => setCreateOpen(true)}
            />
          </TabsContent>
          <TabsContent value="discoverable">
            <CaseLawTable
              rows={discoverable}
              emptyTitle="Nothing discoverable yet"
              emptyDescription="Research other magistrates mark as discoverable will appear here."
            />
          </TabsContent>
        </Tabs>
      )}

      <CreateCaseLawDialog open={createOpen} onOpenChange={setCreateOpen} />
    </BrowsePage>
  );
}

interface CaseLawRow {
  id: string;
  case_name: string;
  citation: string;
  court: string;
  jurisdiction: string;
  owner_id: string | null;
  /** null when the row came from the Court/Jurisdiction-scoped RPC, which doesn't select updated_at. */
  updated_at: string | null;
}

function CaseLawTable({
  rows,
  emptyTitle,
  emptyDescription,
  onCreate,
}: {
  rows: CaseLawRow[];
  emptyTitle: string;
  emptyDescription: string;
  onCreate?: () => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        className="mt-4"
        title={emptyTitle}
        description={emptyDescription}
        action={
          onCreate && (
            <Button size="sm" variant="play" onClick={onCreate}>
              <Plus className="h-4 w-4" />
              New research entry
            </Button>
          )
        }
      />
    );
  }

  return (
    <TitleGallery>
      {rows.map((row) => (
        <TitleCard
          key={row.id}
          tone="case-law"
          eyebrow={row.citation}
          title={row.case_name}
          subtitle={[row.court, row.jurisdiction].filter(Boolean).join(" · ")}
          badge={row.owner_id === null ? "Canonical" : undefined}
          href={ROUTES.caseLawDetail(row.id)}
        />
      ))}
    </TitleGallery>
  );
}
