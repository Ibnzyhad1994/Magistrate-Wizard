import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search as SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { BrowseHeader, BrowsePage, TitleCard, TitleCardSkeletonGallery, TitleGallery } from "@/components/browse";
import { useGlobalSearch } from "@/hooks/search/use-global-search";
import { ROUTES } from "@/routes/paths";
import type { TitleCardTone } from "@/lib/browse-tones";
import type { SearchResult } from "@/types/database.types";

const TYPE_LABELS: Record<string, string> = {
  case: "Case",
  bench_note: "Bench Note",
  statute: "Legislation",
  case_law: "Case Law",
  docket_matter: "Docket Matter",
  judgment: "Judgment",
  quick_code: "Quick Code",
};

const TYPE_TONE: Record<string, TitleCardTone> = {
  case: "bookmark",
  bench_note: "note",
  statute: "legislation",
  case_law: "case-law",
  docket_matter: "docket",
  judgment: "judgment",
  quick_code: "code",
};

// Only entity types with a live, routable detail page in this frontend.
// `case` predates this rebuild and still has no detail route — its
// search results are shown (RLS already decided visibility), just
// without a working link. `statute` now does (Legislation workspace).
const TYPE_ROUTE: Partial<Record<string, (id: string) => string>> = {
  bench_note: ROUTES.benchNoteDetail,
  case_law: ROUTES.caseLawDetail,
  docket_matter: ROUTES.docketMatter,
  judgment: ROUTES.judgmentDetail,
  quick_code: () => ROUTES.quickCodes,
  statute: ROUTES.legislationDetail,
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
    <p className="line-clamp-2 text-[11px] leading-snug text-white/60">
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
          <mark key={i} className="bg-primary/40 text-white">
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
  const [searchParams] = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [input, setInput] = useState(urlQuery);
  const [query, setQuery] = useState(urlQuery);

  useEffect(() => {
    setInput(urlQuery);
    setQuery(urlQuery);
  }, [urlQuery]);

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
    <BrowsePage>
      <BrowseHeader
        title="Search"
        description="Search across Docket Matters, Judgments, Case Law, Quick Codes, Bench Notes, Cases, and Legislation. Results are limited to what you're already allowed to see."
        showViewSelect
      />

      <div className="relative mb-8 max-w-lg">
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
        <TitleCardSkeletonGallery />
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={SearchIcon}
          title="No results"
          description={`Nothing matched "${query.trim()}".`}
        />
      ) : (
        <div className="space-y-10">
          {Array.from(grouped.entries()).map(([type, results]) => (
            <section key={type}>
              <h2 className="mb-4 text-xl font-bold text-white">
                {TYPE_LABELS[type] ?? type}
                <span className="ml-2 text-sm font-normal text-white/50">({results.length})</span>
              </h2>
              <TitleGallery>
                {results.map((r) => {
                  const route = r.id ? TYPE_ROUTE[type]?.(r.id) : undefined;
                  return (
                    <TitleCard
                      key={`${type}-${r.id}`}
                      tone={TYPE_TONE[type] ?? "bookmark"}
                      eyebrow={TYPE_LABELS[type] ?? type}
                      title={r.title ?? "Untitled"}
                      subtitle={r.subtitle ?? undefined}
                      href={route}
                    >
                      <Headline text={r.headline} />
                    </TitleCard>
                  );
                })}
              </TitleGallery>
            </section>
          ))}
        </div>
      )}
    </BrowsePage>
  );
}
