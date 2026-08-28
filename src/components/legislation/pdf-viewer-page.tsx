import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { PdfjsDocument, PdfjsTextItem } from "@/lib/legislation-pdf";

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
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [rects, setRects] = useState<{ left: number; top: number; width: number; height: number; active: boolean }[]>([]);

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

  return (
    <div
      ref={containerRef}
      data-page-number={pageNumber}
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
      <div className="absolute bottom-1 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/80">
        {pageNumber}
      </div>
    </div>
  );
}
