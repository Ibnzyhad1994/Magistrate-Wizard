import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/common/inline-error";
import { BookmarkToggle } from "@/components/common/bookmark-toggle";
import { useStatute } from "@/hooks/legislation/use-legislation";
import { useBackNav } from "@/hooks/use-back-nav";
import { formatDate } from "@/lib/utils";
import { ROUTES } from "@/routes/paths";

/**
 * Read-only reference view over the existing `statutes` row — no edit
 * form (write access is admin-only per RLS and there is no ingestion/
 * curation UI yet, see use-legislation.ts). Renders `full_text` as
 * preformatted plain text, never as AI-generated or rewritten content —
 * this is exactly the stored source text, nothing else ("do not present
 * AI summaries as statutory text").
 */
export default function LegislationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const back = useBackNav(ROUTES.legislation, "Back to Legislation");
  const { data: statute, isPending, isError, error, refetch } = useStatute(id);

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError) return <InlineError error={error} onRetry={() => void refetch()} />;
  if (!statute) {
    return (
      <InlineError
        error={new Error("This item doesn't exist, or you don't have access to it.")}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate(back.to)}>
          <ArrowLeft className="h-4 w-4" />
          {back.label}
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {statute.title}
          </h1>
          <Badge variant="canonical">Canonical</Badge>
          <BookmarkToggle entityType="statute" entityId={statute.id} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {[statute.code, statute.jurisdiction].filter(Boolean).join(" · ")}
          {statute.effective_date ? ` · Effective ${formatDate(statute.effective_date)}` : ""}
        </p>
      </div>

      {statute.source_url && (
        <a
          href={statute.source_url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          View original source
        </a>
      )}

      {statute.summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-foreground">{statute.summary}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Text</CardTitle>
        </CardHeader>
        <CardContent>
          {statute.full_text ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {statute.full_text}
            </p>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              No full text on record for this item.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
