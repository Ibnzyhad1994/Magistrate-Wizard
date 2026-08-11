import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScrollText, Search } from "lucide-react";
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
  const navigate = useNavigate();
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Legislation
        </h1>
        <p className="text-sm text-muted-foreground">
          Acts, regulations, and other legal instruments — maintained
          centrally and available to every magistrate.
        </p>
      </div>

      <div className="max-w-sm space-y-1">
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
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={ScrollText}
              className="border-0"
              title={data && data.length > 0 ? "No matches" : "No legislation yet"}
              description={
                data && data.length > 0
                  ? "Try a different search term."
                  : "Acts and regulations added to the shared library will appear here."
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
                  <TableHead>Code</TableHead>
                  <TableHead>Jurisdiction</TableHead>
                  <TableHead className="text-right">Effective</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow
                    key={s.id}
                    className="cursor-pointer"
                    onClick={() => navigate(ROUTES.legislationDetail(s.id))}
                  >
                    <TableCell className="font-medium text-foreground">{s.title}</TableCell>
                    <TableCell className="text-muted-foreground">{s.code}</TableCell>
                    <TableCell className="text-muted-foreground">{s.jurisdiction}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {s.effective_date ? formatDate(s.effective_date) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
