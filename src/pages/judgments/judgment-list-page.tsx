import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Scale, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { BrowseHeader, BrowsePage, TitleCard, TitleGallery } from "@/components/browse";
import { useAuth } from "@/hooks/use-auth";
import { useJudgments } from "@/hooks/judgments/use-judgments";
import { useScopedSearchIds } from "@/hooks/use-scoped-search";
import { CreateJudgmentDialog } from "@/pages/judgments/create-judgment-dialog";
import { ROUTES } from "@/routes/paths";
import { formatDate, toTitleCase } from "@/lib/utils";

export default function JudgmentListPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, isPending, isError, error, refetch } = useJudgments();
  // Real full-text search over Judgments' own search_vector (title,
  // case_number, court_name, citation, content_text) — scoped to
  // Judgments only, never Global Search. Previously this list had no
  // search at all.
  const { data: matchingIds, isPending: searchPending } = useScopedSearchIds(
    "search_judgments",
    query,
  );

  const { drafts, finals, discoverable } = useMemo(() => {
    const all = data ?? [];
    const q = query.trim();
    const matches = (row: (typeof all)[number]) => !q || (matchingIds?.has(row.id) ?? false);
    return {
      drafts: all.filter((j) => j.owner_id === user?.id && j.status === "draft" && matches(j)),
      finals: all.filter((j) => j.owner_id === user?.id && j.status === "final" && matches(j)),
      discoverable: all.filter(
        (j) => j.owner_id !== user?.id && j.is_discoverable && matches(j),
      ),
    };
  }, [data, user?.id, query, matchingIds]);

  return (
    <BrowsePage>
      <BrowseHeader
        title="Judgments"
        description="Your draft and final judgments, plus judgments other magistrates have made discoverable."
        action={
          <Button variant="play" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New draft
          </Button>
        }
      />

      <div className="max-w-sm space-y-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search title, case number, citation, or text…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search judgments"
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
        <Tabs defaultValue="drafts">
          <TabsList>
            <TabsTrigger value="drafts">My Drafts ({drafts.length})</TabsTrigger>
            <TabsTrigger value="final">My Final ({finals.length})</TabsTrigger>
            <TabsTrigger value="discoverable">
              Discoverable ({discoverable.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="drafts">
            <JudgmentTable
              rows={drafts}
              onOpen={(id) => navigate(ROUTES.judgmentDetail(id))}
              emptyTitle="No drafts yet"
              emptyDescription="Start a new judgment draft to see it here."
              onCreate={() => setCreateOpen(true)}
            />
          </TabsContent>
          <TabsContent value="final">
            <JudgmentTable
              rows={finals}
              onOpen={(id) => navigate(ROUTES.judgmentDetail(id))}
              emptyTitle="No finalized judgments yet"
              emptyDescription="Finalized judgments you own will appear here."
            />
          </TabsContent>
          <TabsContent value="discoverable">
            <JudgmentTable
              rows={discoverable}
              onOpen={(id) => navigate(ROUTES.judgmentDetail(id))}
              emptyTitle="Nothing discoverable yet"
              emptyDescription="Judgments other magistrates mark as discoverable will appear here."
            />
          </TabsContent>
        </Tabs>
      )}

      <CreateJudgmentDialog open={createOpen} onOpenChange={setCreateOpen} />
    </BrowsePage>
  );
}

interface JudgmentRow {
  id: string;
  title: string;
  case_number: string | null;
  citation: string | null;
  status: string;
  updated_at: string;
}

function JudgmentTable({
  rows,
  onOpen,
  emptyTitle,
  emptyDescription,
  onCreate,
}: {
  rows: JudgmentRow[];
  onOpen: (id: string) => void;
  emptyTitle: string;
  emptyDescription: string;
  onCreate?: () => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        className="mt-4"
        title={emptyTitle}
        description={emptyDescription}
        action={
          onCreate && (
            <Button size="sm" variant="play" onClick={onCreate}>
              <Plus className="h-4 w-4" />
              New draft
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
          tone="judgment"
          eyebrow={row.case_number ?? undefined}
          title={row.title}
          subtitle={row.citation ?? undefined}
          meta={[toTitleCase(row.status), formatDate(row.updated_at)]}
          badge={toTitleCase(row.status)}
          href={ROUTES.judgmentDetail(row.id)}
          onClick={() => onOpen(row.id)}
        />
      ))}
    </TitleGallery>
  );
}
