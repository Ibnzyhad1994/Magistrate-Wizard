import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import type { PdfjsDocument, PdfjsTextItem } from "@/lib/legislation-pdf";
import {
  isUsableRedactionBox,
  normalizedToPixelRect,
  pixelRectToNormalized,
  type RedactionBox,
} from "@/lib/redaction";

/** A box on this page, paired with its index in the viewer's full list. */
export type PageRedactionEntry = { box: RedactionBox; index: number };

export interface PageHighlight {
  itemIndex: number;
  charStart: number;
  charEnd: number;
  active: boolean;
}

interface ViewportLike {
  width: number;
  height: number;
  /** [x, y] in PDF user space -> [x, y] in viewport (canvas pixel) space. This pdfjs-dist version has no convertToViewportRectangle — a rectangle is two point conversions. */
  convertToViewportPoint: (x: number, y: number) => number[];
}

function highlightRect(item: PdfjsTextItem, h: PageHighlight, viewport: ViewportLike) {
  const [, , , , e, f] = item.transform;
  const total = item.str.length || 1;
  const x1 = e + (h.charStart / total) * item.width;
  const x2 = e + (h.charEnd / total) * item.width;
  const y1 = f;
  const y2 = f + (item.height || 1);
  const [vx1, vy1] = viewport.convertToViewportPoint(x1, y1);
  const [vx2, vy2] = viewport.convertToViewportPoint(x2, y2);
  return {
    left: Math.min(vx1, vx2),
    top: Math.min(vy1, vy2),
    width: Math.abs(vx2 - vx1),
    height: Math.abs(vy2 - vy1),
  };
}

/**
 * One page of a Legislation PDF — canvas render (the ORIGINAL page,
 * unaltered, per §"the PDF itself must be the authoritative visual
 * source") plus an absolutely-positioned highlight overlay for search
 * matches. `IntersectionObserver`-gated so a long Act only keeps nearby
 * pages rendered, bounding memory during continuous scroll.
 */
export function PdfViewerPage({
  doc,
  pageNumber,
  scale,
  rotation,
  pageItems,
  highlights,
  scrollToActive,
  onSize,
  redactMode = false,
  redactionBoxes = [],
  onRedactionBox,
  onRemoveRedactionBox,
  onRedactBlockedByRotation,
}: {
  doc: PdfjsDocument;
  pageNumber: number;
  scale: number;
  rotation: number;
  /** This page's text items, once the search pass has loaded (see use-pdf-search.ts) — null before that, or when search has never been used. */
  pageItems: PdfjsTextItem[] | null;
  highlights: PageHighlight[];
  scrollToActive: boolean;
  onSize?: (size: { width: number; height: number }) => void;
  redactMode?: boolean;
  redactionBoxes?: PageRedactionEntry[];
  onRedactionBox?: (box: RedactionBox) => void;
  /** Index is into the viewer's full box list, not this page's slice. */
  onRemoveRedactionBox?: (index: number) => void;
  onRedactBlockedByRotation?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [rects, setRects] = useState<{ left: number; top: number; width: number; height: number; active: boolean }[]>([]);
  const [draft, setDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const drawingRef = useRef(false);
  const draftRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const updateDraft = (next: { x: number; y: number; width: number; height: number } | null) => {
    draftRef.current = next;
    setDraft(next);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => setIsVisible(entries[0]?.isIntersecting ?? false),
      { rootMargin: "1000px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    let renderTask: { promise: Promise<unknown>; cancel: () => void } | null = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale, rotation }) as unknown as ViewportLike;
      const next = { width: viewport.width, height: viewport.height };
      setSize(next);
      onSize?.(next);
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const task = page.render({ canvasContext: ctx, viewport });
      renderTask = task;
      try {
        await task.promise;
      } catch {
        // Cancelled render (page scrolled away / scale changed mid-render) -- not an error to surface.
        return;
      }
      if (!cancelled && pageItems) {
        setRects(
          highlights.map((h) => ({
            ...highlightRect(pageItems[h.itemIndex], h, viewport),
            active: h.active,
          })),
        );
      }
      page.cleanup();
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber, scale, rotation, isVisible, pageItems, highlights]);

  useEffect(() => {
    if (scrollToActive) {
      containerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [scrollToActive]);

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!redactMode) return;
    if (rotation !== 0) {
      onRedactBlockedByRotation?.();
      return;
    }
    const bounds = e.currentTarget.getBoundingClientRect();
    drawingRef.current = true;
    updateDraft({ x: e.clientX - bounds.left, y: e.clientY - bounds.top, width: 0, height: 0 });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current || !draftRef.current) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    const prev = draftRef.current;
    updateDraft({
      ...prev,
      width: e.clientX - bounds.left - prev.x,
      height: e.clientY - bounds.top - prev.y,
    });
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const pageSize = size ?? e.currentTarget.getBoundingClientRect();
    const finalDraft = draftRef.current;
    updateDraft(null);
    if (!finalDraft || !onRedactionBox) return;
    const box = pixelRectToNormalized(finalDraft, pageSize, pageNumber);
    if (isUsableRedactionBox(box)) onRedactionBox(box);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && drawingRef.current) {
      e.preventDefault();
      drawingRef.current = false;
      updateDraft(null);
    }
  };

  return (
    <div
      ref={containerRef}
      data-page-number={pageNumber}
      // Deliberately literal bg-white, not a theme token: this is the sheet
      // of paper the PDF renders onto. A page of an Act is white in both
      // themes — theming it would tint the document itself and misrepresent
      // what the file actually looks like.
      className="relative mx-auto mb-4 bg-white shadow-md"
      style={size ? { width: size.width, height: size.height } : { minHeight: 400, width: "100%" }}
    >
      {isVisible ? (
        <canvas ref={canvasRef} className="block" />
      ) : (
        <div className="flex h-full min-h-[400px] items-center justify-center text-xs text-muted-foreground">
          Page {pageNumber}
        </div>
      )}
      {rects.map((r, i) => (
        <div
          key={i}
          className={cn(
            "pointer-events-none absolute rounded-[1px] mix-blend-multiply",
            r.active ? "bg-orange-400" : "bg-yellow-300",
          )}
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        />
      ))}
      {redactionBoxes.map(({ box, index }) => {
        const px = size
          ? normalizedToPixelRect(box, size)
          : { x: 0, y: 0, width: 0, height: 0 };
        return (
          <div
            key={`redact-${index}`}
            className={cn(
              "pointer-events-none absolute bg-black",
              // A hairline only while editing, so it reads as an object you
              // can act on rather than part of the page.
              redactMode && "outline outline-1 outline-offset-1 outline-white/70",
            )}
            style={{ left: px.x, top: px.y, width: px.width, height: px.height }}
          />
        );
      })}
      {draft && (
        <div
          className="pointer-events-none absolute bg-black/80"
          style={{
            left: Math.min(draft.x, draft.x + draft.width),
            top: Math.min(draft.y, draft.y + draft.height),
            width: Math.abs(draft.width),
            height: Math.abs(draft.height),
          }}
        />
      )}
      {redactMode ? (
        <div
          className="absolute inset-0 cursor-crosshair"
          role="application"
          tabIndex={0}
          aria-label={`Draw a redaction box on page ${pageNumber}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onKeyDown={handleKeyDown}
        />
      ) : null}
      {/* Deliberately after the drawing surface: that surface covers the whole
          page, so anything meant to be clickable has to sit above it. Removal
          is an explicit control rather than a click on the box itself — the
          box is a drag target, and making it also a delete target would turn
          a slightly-missed drag into silent data loss. */}
      {redactMode && onRemoveRedactionBox
        ? redactionBoxes.map(({ box, index }, i) => {
            const px = size
              ? normalizedToPixelRect(box, size)
              : { x: 0, y: 0, width: 0, height: 0 };
            return (
              <button
                key={`remove-redact-${index}`}
                type="button"
                className="absolute z-10 flex h-6 w-6 items-center justify-center rounded-full border border-foreground/80 bg-black text-foreground shadow-sm transition-colors hover:bg-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ left: px.x + px.width - 12, top: px.y - 12 }}
                // The drawing surface below listens on pointerdown; without
                // stopping here, pressing this button also starts a drag.
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemoveRedactionBox(index);
                }}
                aria-label={`Remove redaction box ${i + 1} on page ${pageNumber}`}
                title="Remove this box"
              >
                <span aria-hidden="true" className="text-sm leading-none">
                  &times;
                </span>
              </button>
            );
          })
        : null}
      <div className="pointer-events-none absolute bottom-1 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-foreground/80">
        {pageNumber}
      </div>
    </div>
  );
}
