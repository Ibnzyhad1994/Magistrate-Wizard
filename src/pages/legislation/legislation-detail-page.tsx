import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Copy,
  ExternalLink,
  Menu,
  StickyNote,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/common/inline-error";
import { BookmarkToggle } from "@/components/common/bookmark-toggle";
import { useStatute, useStatuteProvisions } from "@/hooks/legislation/use-legislation";
import { useBackNav } from "@/hooks/use-back-nav";
import { formatDate, cn } from "@/lib/utils";
import { ROUTES } from "@/routes/paths";
import { CreateBenchNoteDialog } from "@/pages/bench-notes/create-bench-note-dialog";
import { Billboard } from "@/components/browse";
import { toast } from "sonner";
import type { StatuteProvision } from "@/types/database.types";

const LEVEL_ORDER = ["part", "chapter", "section", "subsection", "paragraph", "schedule"];
const LEVEL_LABELS: Record<string, string> = {
  part: "Part",
  chapter: "Chapter",
  section: "Section",
  subsection: "Subsection",
  paragraph: "Paragraph",
  schedule: "Schedule",
};

function indentFor(level: string) {
  const idx = LEVEL_ORDER.indexOf(level);
  return Math.max(idx, 0) * 12;
}

/**
 * Structured Legislation reader over `statute_provisions` (0055) — left
 * navigation (Part/Chapter/Section/Subsection/Paragraph/Schedule, in
 * document order via sort_order, indented by level since the current
 * deterministic-extraction ingestion path does not attempt to infer real
 * parent/child nesting from indentation — see legal-extraction.ts) plus a
 * main reading pane for the selected provision. Falls back to the flat
 * `full_text` rendering (pre-0055 behavior) whenever an Act has no
 * structured provisions on record, so older/manually-created Legislation
 * rows are never left with a broken reader.
 *
 * Stable anchors: /legislation/:id/section/:provisionId (ROUTES.legislationProvision)
 * — never derived from display text, always the provision's own id.
 */
export default function LegislationDetailPage() {
  const { id, provisionId } = useParams<{ id: string; provisionId?: string }>();
  const navigate = useNavigate();
  const back = useBackNav(ROUTES.legislation, "Back to Legislation");
  const { data: statute, isPending, isError, error, refetch } = useStatute(id);
  const { data: provisions, isPending: provisionsPending } = useStatuteProvisions(id);
  const [noteOpen, setNoteOpen] = useState(false);
  const [navSheetOpen, setNavSheetOpen] = useState(false);

  const selected = useMemo(
    () => provisions?.find((p) => p.id === provisionId) ?? null,
    [provisions, provisionId],
  );

  if (isPending) {
    return (
      <div className="browse-gutter space-y-4 pt-24">
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

  const hasStructure = !provisionsPending && (provisions?.length ?? 0) > 0;

  function citationFor(p: StatuteProvision) {
    const label = `${LEVEL_LABELS[p.level] ?? p.level}${p.number ? ` ${p.number}` : ""}`;
    return `${statute!.title}, ${label}`;
  }

  async function copyText(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied.`);
    } catch {
      toast.error(`Couldn't copy ${what.toLowerCase()}.`);
    }
  }

  const nav = (
    <nav className="space-y-0.5" aria-label="Act contents">
      <button
        type="button"
        onClick={() => {
          navigate(ROUTES.legislationDetail(statute.id));
          setNavSheetOpen(false);
        }}
        className={cn(
          "block w-full rounded px-2 py-1.5 text-left text-sm font-medium hover:bg-muted",
          !provisionId && "bg-muted text-primary",
        )}
      >
        Overview
      </button>
      {provisions?.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => {
            navigate(ROUTES.legislationProvision(statute.id, p.id));
            setNavSheetOpen(false);
          }}
          style={{ paddingLeft: `${8 + indentFor(p.level)}px` }}
          className={cn(
            "block w-full truncate rounded py-1.5 pr-2 text-left text-sm hover:bg-muted",
            p.id === provisionId ? "bg-muted text-primary" : "text-foreground/90",
          )}
          title={p.heading ?? undefined}
        >
          <span className="text-muted-foreground">
            {LEVEL_LABELS[p.level] ?? p.level}
            {p.number ? ` ${p.number}` : ""}
          </span>
          {p.heading ? <span className="ml-1.5">{p.heading}</span> : null}
        </button>
      ))}
    </nav>
  );

  return (
    <>
      <Billboard
        eyebrow={statute.code}
        title={statute.title}
        description={
          [
            statute.short_title,
            statute.jurisdiction,
            statute.chapter_number ? `Chapter ${statute.chapter_number}` : null,
            statute.effective_date ? `Effective ${formatDate(statute.effective_date)}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        badges={[
          "Canonical",
          ...(statute.review_status !== "published"
            ? [
                statute.review_status === "draft"
                  ? "Draft (admin only)"
                  : "Needs review (admin only)",
              ]
            : []),
        ]}
        tone="legislation"
        primaryAction={{ label: back.label, onClick: () => navigate(back.to) }}
      />
      <div className="browse-gutter relative z-10 -mt-8 space-y-8 pb-20">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="canonical">Canonical</Badge>
          {statute.review_status !== "published" && (
            <Badge variant="secondary">
              {statute.review_status === "draft" ? "Draft (admin only)" : "Needs review (admin only)"}
            </Badge>
          )}
          <BookmarkToggle entityType="statute" entityId={statute.id} />
        </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setNoteOpen(true)}>
          <StickyNote className="h-4 w-4" />
          New Bench Note
        </Button>
        {statute.source_url && (
          <Button size="sm" variant="ghost" asChild>
            <a href={statute.source_url} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="h-3.5 w-3.5" />
              View original source
            </a>
          </Button>
        )}
        {hasStructure && (
          <Sheet open={navSheetOpen} onOpenChange={setNavSheetOpen}>
            <SheetTrigger asChild>
              <Button size="sm" variant="ghost" className="lg:hidden">
                <Menu className="h-4 w-4" />
                Contents
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 overflow-y-auto p-3">
              {nav}
            </SheetContent>
          </Sheet>
        )}
      </div>

      {hasStructure ? (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <aside className="hidden max-h-[calc(100vh-14rem)] overflow-y-auto rounded-lg border border-border p-2 lg:sticky lg:top-4 lg:block">
            {nav}
          </aside>

          <div className="min-w-0 space-y-4">
            {selected ? (
              <Card>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">
                      {LEVEL_LABELS[selected.level] ?? selected.level}
                      {selected.number ? ` ${selected.number}` : ""}
                      {selected.heading ? ` — ${selected.heading}` : ""}
                    </CardTitle>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <BookmarkToggle entityType="statute_provision" entityId={selected.id} />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setNoteOpen(true) /* opens with Act-level default below; see note dialog for provision */
                      }
                    >
                      <StickyNote className="h-4 w-4" />
                      Note
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyText(selected.body_text ?? "", "Provision text")}
                    >
                      <Copy className="h-4 w-4" />
                      Copy text
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyText(citationFor(selected), "Citation")}
                    >
                      <Copy className="h-4 w-4" />
                      Copy citation
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {selected.body_text ? (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {selected.body_text}
                    </p>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">
                      This provision has a heading but no separately recorded body text.
                    </p>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Overview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {statute.summary && (
                    <p className="text-sm text-foreground">{statute.summary}</p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {provisions?.length ?? 0} provision{(provisions?.length ?? 0) === 1 ? "" : "s"}{" "}
                    on record. Select an item from Contents to read it.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}

      <CreateBenchNoteDialog
        open={noteOpen}
        onOpenChange={setNoteOpen}
        defaultParent={
          selected
            ? {
                entityType: "statute_provision",
                entityId: selected.id,
                label: `${statute.title} — ${LEVEL_LABELS[selected.level] ?? selected.level}${selected.number ? ` ${selected.number}` : ""}`,
              }
            : { entityType: "statute", entityId: statute.id, label: statute.title }
        }
      />
    </div>
    </>
  );
}
