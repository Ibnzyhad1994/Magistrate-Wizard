import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search as SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { useGlobalSearch } from "@/hooks/search/use-global-search";
import { ROUTES } from "@/routes/paths";
import type { SearchResult } from "@/types/database.types";

const TYPE_LABELS: Record<string, string> = {
  case: "Case",
  bench_note: "Bench Note",
  statute: "Statute",
  case_law: "Case Law",
  docket_matter: "Docket Matter",
  judgment: "Judgment",
  quick_code: "Quick Code",
};

// Only entity types with a live, routable detail page in this frontend.
// `case` and `statute` predate this rebuild and have no detail route —
// their search results are still shown (RLS already decided visibility),
// just without a working link.
const TYPE_ROUTE: Partial<Record<string, (id: string) => string>> = {
  bench_note: ROUTES.benchNoteDetail,
  case_law: ROUTES.caseLawDetail,
  docket_matter: ROUTES.docketMatter,
  judgment: ROUTES.judgmentDetail,
  quick_code: () => ROUTES.quickCodes,
};

/**
 * Renders a `ts_headline()` fragment safely. Postgres wraps matched terms
 * in literal `<b>...</b>` (the default StartSel/StopSel) but does NOT
 * HTML-escape the surrounding text — since that text ultimately comes
 * from user-entered content (Bench Note text, Quick Code content, etc.),
 * blindly rendering it with `dangerouslySetInnerHTML` would be an XSS
 * hole. Instead we split on the literal delimiters and let React escape
 * every text segment normally, only using real DOM emphasis for the
 * matched spans.
 */
function Headline({ text }: { text: string | null }) {
  if (!text) return null;
  const parts = text.split(/(<b>|<\/b>)/);
  let bold = false;
  return (
    <p className="text-sm text-muted-foreground">
      {parts.map((part, i) => {
        if (part === "<b>") {
          bold = true;
          return null;
        }
        if (part === "</b>") {
          bold = false;
          return null;
        }
        return bold ? (
          <mark key={i} className="bg-primary/20 text-foreground">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </p>
  );
}

export default function SearchPage() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(input), 350);
    return () => clearTimeout(timer);
  }, [input]);

  const { data, isPending, isFetching, isError, error, refetch } = useGlobalSearch(query);

  const grouped = useMemo(() => {
    const groups = new Map<string, SearchResult[]>();
    for (const result of data ?? []) {
      if (!result.entity_type) continue;
      const list = groups.get(result.entity_type) ?? [];
      list.push(result);
      groups.set(result.entity_type, list);
    }
    return groups;
  }, [data]);

  const hasQuery = query.trim().length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Search</h1>
        <p className="text-sm text-muted-foreground">
          Search across Docket Matters, Judgments, Case Law, Quick Codes,
          Bench Notes, Cases, and Statutes — results are limited to what
          you're already allowed to see.
        </p>
      </div>

      <div className="relative max-w-lg">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Search everything…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Search"
          autoFocus
        />
      </div>

      {!hasQuery ? (
        <EmptyState
          icon={SearchIcon}
          title="Start typing to search"
          description="Search matches titles and content across everything you have access to."
        />
      ) : isPending || isFetching ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={SearchIcon}
          title="No results"
          description={`Nothing matched "${query.trim()}".`}
        />
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([type, results]) => (
            <div key={type}>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {TYPE_LABELS[type] ?? type} ({results.length})
              </p>
              <div className="space-y-2">
                {results.map((r) => {
                  const route = r.id ? TYPE_ROUTE[type]?.(r.id) : undefined;
                  return (
                    <Card
                      key={`${type}-${r.id}`}
                      className={route ? "cursor-pointer transition-colors hover:bg-muted/40" : undefined}
                      onClick={() => route && navigate(route)}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{TYPE_LABELS[type] ?? type}</Badge>
                          <span className="font-medium text-foreground">{r.title}</span>
                          {r.subtitle && (
                            <span className="text-sm text-muted-foreground">{r.subtitle}</span>
                          )}
                        </div>
                        <Headline text={r.headline} />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
