import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ExternalLink, FileWarning, Menu, Pencil, StickyNote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/common/inline-error";
import { BookmarkToggle } from "@/components/common/bookmark-toggle";
import { DocumentsPanel } from "@/components/common/documents-panel";
import { useAuth } from "@/hooks/use-auth";
import {
  useStatute,
  useStatuteProvisions,
  useSupersedingStatute,
} from "@/hooks/legislation/use-legislation";
import { LegislationPdfViewer } from "@/components/legislation/legislation-pdf-viewer";
import { useBackNav } from "@/hooks/use-back-nav";
import { formatDate, cn } from "@/lib/utils";
import { ROUTES } from "@/routes/paths";
import { CreateBenchNoteDialog } from "@/pages/bench-notes/create-bench-note-dialog";
import { Billboard } from "@/components/browse";

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
 * Legislation READ-ONLY viewer — the default `/legislation/:id`
 * experience. This page mounts NO editing surface at all: no editable
 * metadata inputs, no replace-file control, no upload/drag-and-drop
 * areas, no save/publish/delete/version-management actions. It composes
 * exactly three read paths: useStatute (row), useStatuteProvisions
 * (legacy structural content, read-only fallback only), and
 * LegislationPdfViewer (the shared, mutation-free PDF viewer core). The
 * ONLY route to any write capability from here is the "Edit" button,
 * which navigates to the separate, admin-gated /legislation/:id/edit
 * route (LegislationEditPage) — clicking it never mounts an edit form on
 * THIS page.
 *
 * Corrects a prior regression: this route previously combined viewing
 * with inline Edit/Replace-PDF/Delete admin controls on the same
 * component, so any admin opening ANY Legislation record landed on what
 * looked like a management page by default. Editing now lives
 * exclusively on the separate edit route.
 */
export default function LegislationViewerPage() {
  const { id, provisionId } = useParams<{ id: string; provisionId?: string }>();
  const navigate = useNavigate();
  const back = useBackNav(ROUTES.legislation, "Back to Legislation");
  const { hasRole } = useAuth();
  const { data: statute, isPending, isError, error, refetch } = useStatute(id);
  const { data: provisions, isPending: provisionsPending } = useStatuteProvisions(id);
  const { data: supersedingStatute } = useSupersedingStatute(id);
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

  const isAdmin = hasRole("admin");
  const hasPdf = !!statute.primary_document_id;
  const hasStructure = !provisionsPending && (provisions?.length ?? 0) > 0;
  const hasLegacyContent = hasStructure || !!statute.full_text;

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
        variant="detail"
        eyebrow={statute.code}
        title={statute.title}
        description={
          [
            statute.short_title,
            statute.jurisdiction,
            statute.instrument_type,
            statute.chapter_number ? `Chapter ${statute.chapter_number}` : null,
            statute.act_number ? `Act No. ${statute.act_number}` : null,
            statute.enactment_year ? `${statute.enactment_year}` : null,
            statute.effective_date ? `Effective ${formatDate(statute.effective_date)}` : null,
            statute.page_count ? `${statute.page_count} page${statute.page_count === 1 ? "" : "s"}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        badges={[
          "Canonical",
          ...(statute.review_status !== "published" ? ["Unpublished (admin only)"] : []),
          ...(statute.is_current_version === false ? ["Superseded"] : []),
        ]}
        tone="legislation"
        primaryAction={{ label: back.label, onClick: () => navigate(back.to) }}
      />
      <div className="browse-gutter relative z-10 -mt-6 space-y-4 pb-20">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="canonical">Canonical</Badge>
          {statute.review_status !== "published" && (
            <Badge variant="secondary">Unpublished (admin only)</Badge>
          )}
          <BookmarkToggle entityType="statute" entityId={statute.id} />
        </div>

        {statute.is_current_version === false && supersedingStatute && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-200">
            This is a superseded version.{" "}
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={() => navigate(ROUTES.legislationDetail(supersedingStatute.id))}
            >
              View the current version — {supersedingStatute.title}
            </button>
          </div>
        )}

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
          {!hasPdf && hasStructure && (
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
          {/* The ONLY path from this read-only page to any write capability
              -- navigates away entirely to the separate, admin-gated edit
              route (router.tsx: allowedRoles=["admin"]). No edit surface
              is ever mounted here. */}
          {isAdmin && (
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => navigate(ROUTES.legislationEdit(statute.id))}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          )}
        </div>

        {/* The PDF is the main focus of this page. */}
        {hasPdf ? (
          <LegislationPdfViewer
            documentId={statute.primary_document_id}
            title={statute.title}
            className="h-[78dvh] min-h-[520px] overflow-hidden rounded-lg border border-white/10"
          />
        ) : !hasLegacyContent ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <FileWarning className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">PDF unavailable — re-upload required</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {isAdmin
                  ? "This record has no PDF on file. Use Edit above to upload the original document."
                  : "This record has no PDF on file yet. Contact an administrator to have it re-uploaded."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              Legacy extracted text from a previous import — not the
              authoritative document. {isAdmin ? "Use Edit above to attach the original PDF." : ""}
            </div>
            {hasStructure ? (
              <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
                <aside className="hidden max-h-[calc(100vh-14rem)] overflow-y-auto rounded-lg border border-border p-2 lg:sticky lg:top-4 lg:block">
                  {nav}
                </aside>
                <div className="min-w-0 space-y-4">
                  {selected ? (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">
                          {LEVEL_LABELS[selected.level] ?? selected.level}
                          {selected.number ? ` ${selected.number}` : ""}
                          {selected.heading ? ` — ${selected.heading}` : ""}
                        </CardTitle>
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
                        {statute.summary && <p className="text-sm text-foreground">{statute.summary}</p>}
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
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{statute.full_text}</p>
                    ) : (
                      <p className="text-sm italic text-muted-foreground">No full text on record for this item.</p>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}

        {hasPdf && statute.summary && (
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
            <CardTitle className="text-base">Documents</CardTitle>
          </CardHeader>
          <CardContent>
            {/* canUpload is unconditionally false here, even for an admin --
                this is the read-only route; attaching/replacing documents
                is an edit-page action only (see LegislationEditPage). */}
            <DocumentsPanel entityType="statute" entityId={statute.id} canUpload={false} />
          </CardContent>
        </Card>

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
