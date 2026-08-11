import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { useJudgments } from "@/hooks/judgments/use-judgments";
import { CreateJudgmentDialog } from "@/pages/judgments/create-judgment-dialog";
import { ROUTES } from "@/routes/paths";
import { formatDate, toTitleCase } from "@/lib/utils";

export default function JudgmentListPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, isPending, isError, error, refetch } = useJudgments();

  const { drafts, finals, discoverable } = useMemo(() => {
    const all = data ?? [];
    return {
      drafts: all.filter((j) => j.owner_id === user?.id && j.status === "draft"),
      finals: all.filter((j) => j.owner_id === user?.id && j.status === "final"),
      discoverable: all.filter((j) => j.owner_id !== user?.id && j.is_discoverable),
    };
  }, [data, user?.id]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Judgments
          </h1>
          <p className="text-sm text-muted-foreground">
            Your draft and final judgments, plus judgments other magistrates
            have made discoverable.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New draft
        </Button>
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
    </div>
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
      <Card className="mt-2">
        <CardContent className="p-0">
          <EmptyState
            icon={Scale}
            className="border-0"
            title={emptyTitle}
            description={emptyDescription}
            action={
              onCreate && (
                <Button size="sm" onClick={onCreate}>
                  <Plus className="h-4 w-4" />
                  New draft
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
              <TableHead>Title</TableHead>
              <TableHead>Case number</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Last updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="cursor-pointer" onClick={() => onOpen(row.id)}>
                <TableCell className="font-medium text-foreground">{row.title}</TableCell>
                <TableCell className="text-muted-foreground">
                  {row.case_number || "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={row.status === "final" ? "default" : "secondary"}>
                    {toTitleCase(row.status)}
                  </Badge>
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
