import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize,
  Minimize,
  Printer,
  RotateCw,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { InlineError } from "@/components/common/inline-error";
import { usePrimaryLegislationDocument } from "@/hooks/legislation/use-legislation";
import { usePdfDocument } from "@/hooks/legislation/use-pdf-document";
import { usePdfSearch } from "@/hooks/legislation/use-pdf-search";
import { downloadDocumentBlob, getDocumentViewUrl } from "@/hooks/use-documents";
import { PdfViewerPage, type PageHighlight } from "@/components/legislation/pdf-viewer-page";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const MIN_SCALE = 0.4;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.15;

/**
 * Core Legislation PDF viewer — READ-ONLY, and deliberately presentation-
 * agnostic (no Dialog/route assumptions of its own) so it can be embedded
 * directly as a page's main content (LegislationViewerPage, the default
 * `/legislation/:id` experience) or wrapped in a modal
 * (LegislationPdfViewerDialog, used by the admin edit page for a
 * PDF preview) without duplicating the pdfjs/search/render machinery.
 *
 * This component has NO knowledge of editing: no form state, no
 * replace-file control, no mutation calls of any kind — only
 * downloadDocumentBlob/getDocumentViewUrl (read paths) and
 * usePrimaryLegislationDocument (a read-only query). Nothing here can be
 * escalated into a write operation, by construction, regardless of the
 * caller's role — the actual write boundary is enforced independently by
 * RLS and the edit-only RPCs this file never imports.
 */
export function LegislationPdfViewer({
  documentId,
  title,
  className,
  toolbarClassName,
}: {
  documentId: string | null;
  title: string;
  className?: string;
  /** Dialog wrapper passes extra right-padding here to clear its own fixed-position close button — an embedded page usage has no such button and leaves this unset. */
  toolbarClassName?: string;
}) {
  const { data: doc, isPending: docRowPending } = usePrimaryLegislationDocument(documentId);
  const pdf = usePdfDocument(doc?.file_path ?? null);

  const [scale, setScale] = useState(1.1);
  const [rotation, setRotation] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [currentPage, setCurrentPage] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const naturalWidthRef = useRef<number | null>(null);
  const naturalHeightRef = useRef<number | null>(null);

  const pdfDoc = pdf.status === "ready" ? pdf.doc : null;
  const numPages = pdf.status === "ready" ? pdf.numPages : 0;
  const search = usePdfSearch(pdfDoc);

  // Reset per-document view state so a previously viewed Act's zoom/
  // page/search never leaks into the next one opened in the same mounted
  // viewer (e.g. the edit page's preview reused across a replace).
  useEffect(() => {
    setScale(1.1);
    setRotation(0);
    setCurrentPage(1);
    setPageInput("1");
    setSearchOpen(false);
    naturalWidthRef.current = null;
    naturalHeightRef.current = null;
  }, [documentId]);

  useEffect(() => setPageInput(String(currentPage)), [currentPage]);

  // Track which page is most visible for the page-count indicator.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !numPages) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-page-number]"));
    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pn = Number(entry.target.getAttribute("data-page-number"));
          ratios.set(pn, entry.intersectionRatio);
        }
        let best = currentPage;
        let bestRatio = 0;
        for (const [pn, ratio] of ratios) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = pn;
          }
        }
        if (bestRatio > 0) setCurrentPage(best);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, scale, rotation]);

  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Ctrl/Cmd+F is captured only while this viewer is mounted and focused
  // -- never a global listener that could hijack the browser's own
  // search on other pages.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        search.clear();
      }
    }
    const el = containerRef.current;
    el?.addEventListener("keydown", onKeyDown);
    return () => el?.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen]);

  const goToPage = useCallback((n: number) => {
    const root = scrollRef.current;
    const target = root?.querySelector<HTMLElement>(`[data-page-number="${n}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  function submitPageInput() {
    const n = Number(pageInput);
    if (Number.isFinite(n) && n >= 1 && n <= numPages) goToPage(Math.round(n));
    else setPageInput(String(currentPage));
  }

  async function computeFit(mode: "width" | "page") {
    if (!pdfDoc) return;
    if (naturalWidthRef.current == null) {
      const page = await pdfDoc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      naturalWidthRef.current = vp.width;
      naturalHeightRef.current = vp.height;
    }
    const container = scrollRef.current;
    if (!container || !naturalWidthRef.current || !naturalHeightRef.current) return;
    const availableWidth = container.clientWidth - 32;
    const availableHeight = container.clientHeight - 32;
    const next =
      mode === "width"
        ? availableWidth / naturalWidthRef.current
        : Math.min(availableWidth / naturalWidthRef.current, availableHeight / naturalHeightRef.current);
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)));
  }

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen?.().catch(() => undefined);
    } else {
      await document.exitFullscreen().catch(() => undefined);
    }
  }

  async function handleDownload() {
    if (!doc) return;
    setDownloading(true);
    try {
      const blob = await downloadDocumentBlob(doc.file_path);
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = doc.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  async function handlePrint() {
    if (!doc) return;
    // A synthetic <a target="_blank"> click, not window.open(): opening a
    // blank window first and redirecting it once the signed URL resolves
    // is silently discarded by Chromium's popup-abuse heuristics --
    // confirmed live. An anchor click after the same async gap works
    // reliably (same technique handleDownload uses above).
    try {
      const url = await getDocumentViewUrl(doc.file_path);
      const a = window.document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
    } catch {
      toast.error("Could not open this document for printing.");
    }
  }

  const highlightsByPage = useMemo(() => {
    const map = new Map<number, PageHighlight[]>();
    search.matches.forEach((m, i) => {
      const list = map.get(m.pageIndex) ?? [];
      list.push({
        itemIndex: m.itemIndex,
        charStart: m.charStart,
        charEnd: m.charEnd,
        active: i === search.currentIndex,
      });
      map.set(m.pageIndex, list);
    });
    return map;
  }, [search.matches, search.currentIndex]);

  useEffect(() => {
    const active = search.currentMatch;
    if (active) goToPage(active.pageIndex + 1);
  }, [search.currentMatch, goToPage]);

  const loading = docRowPending || pdf.status === "loading" || pdf.status === "idle";
  const errored = pdf.status === "error";
  const showScannedNotice = search.hasTextLayer === false;

  return (
    <div ref={containerRef} className={cn("flex min-h-0 flex-col bg-[#181818]", className)}>
      <div className={cn("flex flex-wrap items-center gap-1.5 border-b border-white/10 bg-[#181818] py-2 pl-3 pr-3", toolbarClassName)}>
        <p className="mr-2 min-w-0 flex-1 truncate text-sm font-medium text-white" title={title}>
          {title}
        </p>

        {numPages > 0 && (
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} aria-label="Previous page">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={submitPageInput}
              onKeyDown={(e) => e.key === "Enter" && submitPageInput()}
              className="h-8 w-12 text-center"
              aria-label="Page number"
            />
            <span className="text-xs text-white/60">/ {numPages}</span>
            <Button size="icon" variant="ghost" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= numPages} aria-label="Next page">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setScale((s) => Math.max(MIN_SCALE, s - ZOOM_STEP))} aria-label="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-10 text-center text-xs text-white/60">{Math.round(scale * 100)}%</span>
          <Button size="icon" variant="ghost" onClick={() => setScale((s) => Math.min(MAX_SCALE, s + ZOOM_STEP))} aria-label="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void computeFit("width")}>
            Fit width
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void computeFit("page")}>
            Fit page
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setRotation((r) => (r + 90) % 360)} aria-label="Rotate">
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => void toggleFullscreen()} aria-label="Toggle fullscreen">
            {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </Button>
        </div>

        <Button
          size="icon"
          variant={searchOpen ? "secondary" : "ghost"}
          onClick={() => {
            setSearchOpen((s) => !s);
            if (!searchOpen) requestAnimationFrame(() => searchInputRef.current?.focus());
            else search.clear();
          }}
          aria-label="Search in document"
        >
          <Search className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" onClick={() => void handleDownload()} disabled={!doc || downloading} aria-label="Download">
          <Download className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" onClick={() => void handlePrint()} disabled={!doc} aria-label="Print">
          <Printer className="h-4 w-4" />
        </Button>
      </div>

      {searchOpen && (
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#181818] px-3 py-2">
          <Search className="h-4 w-4 text-white/50" />
          <Input
            ref={searchInputRef}
            value={search.query}
            onChange={(e) => search.setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.shiftKey ? search.prev : search.next)();
            }}
            placeholder="Search this document…"
            className="h-8 max-w-xs"
            aria-label="Search in document"
          />
          {search.loadingText && <LoadingSpinner size={14} />}
          {!search.loadingText && search.query.trim() && search.hasTextLayer !== false && (
            <span className="text-xs text-white/60">
              {search.matches.length === 0
                ? "No matches"
                : `${search.currentIndex + 1} of ${search.matches.length}`}
            </span>
          )}
          <Button size="icon" variant="ghost" disabled={!search.matches.length} onClick={search.prev} aria-label="Previous match">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" disabled={!search.matches.length} onClick={search.next} aria-label="Next match">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              setSearchOpen(false);
              search.clear();
            }}
            aria-label="Close search"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {searchOpen && showScannedNotice && (
        <div className="border-b border-white/10 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
          This PDF does not contain searchable text. You may still view and scroll through the document.
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-black/40 p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner size={28} />
          </div>
        ) : errored ? (
          <div className="p-6">
            <InlineError
              error={pdf.status === "error" ? pdf.error : new Error("Could not load this document.")}
              onRetry={pdf.retry}
            />
          </div>
        ) : !doc ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-white/70">
            <p className="text-sm">This document could not be found.</p>
          </div>
        ) : pdfDoc && numPages > 0 ? (
          Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
            <PdfViewerPage
              key={n}
              doc={pdfDoc}
              pageNumber={n}
              scale={scale}
              rotation={rotation}
              pageItems={search.pagesText?.[n - 1] ?? null}
              highlights={highlightsByPage.get(n - 1) ?? []}
              scrollToActive={false}
            />
          ))
        ) : null}
      </div>
    </div>
  );
}
