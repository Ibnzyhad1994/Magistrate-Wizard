import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, Gavel } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
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
import { useDocketMatters } from "@/hooks/docket/use-docket-matters";
import { useMyCurrentCourts } from "@/hooks/docket/use-lookups";
import { CreateDocketMatterDialog } from "@/pages/docket/create-docket-matter-dialog";
import { ROUTES } from "@/routes/paths";
import { formatDate, toTitleCase } from "@/lib/utils";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  stayed: "secondary",
  completed: "outline",
  archived: "outline",
};

export default function DocketListPage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();
  const { data, isPending, isError, error, refetch } = useDocketMatters(search);
  const { data: myCourts, isPending: courtsPending } = useMyCurrentCourts();
  const noCourts = !courtsPending && (myCourts?.length ?? 0) === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Docket
          </h1>
          <p className="text-sm text-muted-foreground">
            Matters currently assigned to your Court, retained from a prior
            sitting, or shared with you.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          disabled={noCourts}
          title={noCourts ? "You have no current Court assignment." : undefined}
        >
          <Plus className="h-4 w-4" />
          New matter
        </Button>
      </div>

      {noCourts && (
        <p className="text-sm text-muted-foreground">
          You have no current Court assignment, so you can&apos;t create a new
          matter. You can still view and act on matters retained or shared
          with you below. Contact an administrator for a Court assignment.
        </p>
      )}

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search case number, title, or issue…"
          className="pl-8"
          aria-label="Search docket matters"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isPending ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : isError ? (
            <InlineError error={error} onRetry={() => void refetch()} className="border-0" />
          ) : !data || data.length === 0 ? (
            <EmptyState
              icon={Gavel}
              className="border-0"
              title={search ? "No matching matters" : "No docket matters yet"}
              description={
                search
                  ? "Try a different case number, title, or issue."
                  : "Matters you create, are assigned, or are shared on will appear here."
              }
              action={
                !search &&
                !noCourts && (
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Create the first matter
                  </Button>
                )
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case number</TableHead>
                  <TableHead>Matter</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Last updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((matter) => (
                  <TableRow
                    key={matter.id}
                    className="cursor-pointer"
                    onClick={() => navigate(ROUTES.docketMatter(matter.id))}
                  >
                    <TableCell className="font-medium text-foreground">
                      {matter.case_number}
                    </TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground">
                      {matter.matter_title}
                    </TableCell>
                    <TableCell>
                      {matter.status && (
                        <Badge variant={STATUS_VARIANT[matter.status] ?? "outline"}>
                          {toTitleCase(matter.status)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {"updated_at" in matter && matter.updated_at
                        ? formatDate(matter.updated_at)
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateDocketMatterDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
