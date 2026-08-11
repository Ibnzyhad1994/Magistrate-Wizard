import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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
import { useBenchNotes } from "@/hooks/bench-notes/use-bench-notes";
import { CreateBenchNoteDialog } from "@/pages/bench-notes/create-bench-note-dialog";
import { ROUTES } from "@/routes/paths";
import { formatDate } from "@/lib/utils";

const PARENT_TYPE_LABELS: Record<string, string> = {
  docket_matter: "Docket Matter",
  judgment: "Judgment",
  case_law: "Case Law",
};

export default function BenchNotesListPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch } = useBenchNotes();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter((n) => n.title.toLowerCase().includes(q));
  }, [data, query]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Bench Notes
          </h1>
          <p className="text-sm text-muted-foreground">
            Your notes, attached to Docket Matters, Judgments, or Case Law.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New Bench Note
        </Button>
      </div>

      <Input
        className="max-w-sm"
        placeholder="Filter by title…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Filter Bench Notes"
      />

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={StickyNote}
              className="border-0"
              title={data && data.length > 0 ? "No matches" : "No Bench Notes yet"}
              description="Attach a note to a matter, judgment, or case law entry to see it here."
              action={
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  New Bench Note
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>About</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Last updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((note) => (
                  <TableRow
                    key={note.id}
                    className="cursor-pointer"
                    onClick={() => navigate(ROUTES.benchNoteDetail(note.id))}
                  >
                    <TableCell className="font-medium text-foreground">{note.title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {PARENT_TYPE_LABELS[note.entity_type] ?? note.entity_type}
                    </TableCell>
                    <TableCell>
                      <Badge variant={note.status === "published" ? "default" : "secondary"}>
                        {note.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatDate(note.updated_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <CreateBenchNoteDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
