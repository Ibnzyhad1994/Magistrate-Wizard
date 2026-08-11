import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, BookOpen, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { useCaseLawList } from "@/hooks/case-law/use-case-law";
import { useScopedSearchIds } from "@/hooks/use-scoped-search";
import { CreateCaseLawDialog } from "@/pages/case-law/create-case-law-dialog";
import { ROUTES } from "@/routes/paths";
import { formatDate } from "@/lib/utils";

export default function CaseLawListPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, isPending, isError, error, refetch } = useCaseLawList();
  // Real full-text search over Case Law's own search_vector (case_name,
  // citation, court, jurisdiction, summary, full_text) — scoped to Case
  // Law only, never Global Search. Previously this was a client-side
  // substring match over just case_name/citation/court, which couldn't
  // find a match in an entry's summary/full text at all.
  const { data: matchingIds, isPending: searchPending } = useScopedSearchIds(
    "search_case_law",
    query,
  );

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

      <div className="max-w-sm space-y-1">
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
        {query.trim() && searchPending && (
          <p className="text-xs text-muted-foreground">Searching…</p>
        )}
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : (
        <Tabs defaultValue="canonical">
          <TabsList>
            <TabsTrigger value="canonical">Canonical ({canonical.length})</TabsTrigger>
            <TabsTrigger value="mine">My Research ({mine.length})</TabsTrigger>
            <TabsTrigger value="discoverable">
              Discoverable ({discoverable.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="canonical">
            <CaseLawTable
              rows={canonical}
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
  updated_at: string;
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
                  {formatDate(row.updated_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
