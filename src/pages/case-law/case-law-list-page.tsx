import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, BookOpen, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { formatDate } from "@/lib/utils";

export default function CaseLawListPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [courtId, setCourtId] = useState<string | null>(null);
  const [jurisdictionId, setJurisdictionId] = useState<string | null>(null);
  const navigate = useNavigate();
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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Case Law
          </h1>
          <p className="text-sm text-muted-foreground">
            Canonical authorities, your personal research, and research other
            magistrates have made discoverable.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New research entry
        </Button>
      </div>

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
              onOpen={(id) => navigate(ROUTES.caseLawDetail(id))}
              emptyTitle="No canonical authorities match"
              emptyDescription="Canonical Case Law is maintained centrally and will appear here."
            />
          </TabsContent>
          <TabsContent value="mine">
            <CaseLawTable
              rows={mine}
              onOpen={(id) => navigate(ROUTES.caseLawDetail(id))}
              emptyTitle="No personal research yet"
              emptyDescription="Add a research entry to see it here."
              onCreate={() => setCreateOpen(true)}
            />
          </TabsContent>
          <TabsContent value="discoverable">
            <CaseLawTable
              rows={discoverable}
              onOpen={(id) => navigate(ROUTES.caseLawDetail(id))}
              emptyTitle="Nothing discoverable yet"
              emptyDescription="Research other magistrates mark as discoverable will appear here."
            />
          </TabsContent>
        </Tabs>
      )}

      <CreateCaseLawDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
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
  onOpen,
  emptyTitle,
  emptyDescription,
  onCreate,
}: {
  rows: CaseLawRow[];
  onOpen: (id: string) => void;
  emptyTitle: string;
  emptyDescription: string;
  onCreate?: () => void;
}) {
  if (rows.length === 0) {
    return (
      <Card className="mt-2">
        <CardContent className="p-0">
          <EmptyState
            icon={BookOpen}
            className="border-0"
            title={emptyTitle}
            description={emptyDescription}
            action={
              onCreate && (
                <Button size="sm" onClick={onCreate}>
                  <Plus className="h-4 w-4" />
                  New research entry
                </Button>
              )
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-2">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case name</TableHead>
              <TableHead>Citation</TableHead>
              <TableHead>Court</TableHead>
              <TableHead className="text-right">Last updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="cursor-pointer" onClick={() => onOpen(row.id)}>
                <TableCell className="font-medium text-foreground">
                  {row.case_name}
                  {row.owner_id === null && (
                    <Badge variant="canonical" className="ml-2">
                      Canonical
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{row.citation}</TableCell>
                <TableCell className="text-muted-foreground">
                  {row.court}
                  {row.jurisdiction ? ` · ${row.jurisdiction}` : ""}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {row.updated_at ? formatDate(row.updated_at) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
