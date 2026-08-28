import { useCallback, useEffect, useRef, useState } from "react";
import { MIN_DOCUMENT_TEXT_CHARS, normalizeTextItems, type PdfjsDocument, type PdfjsTextItem } from "@/lib/legislation-pdf";

export interface PdfMatch {
  pageIndex: number; // 0-based
  itemIndex: number;
  charStart: number;
  charEnd: number;
}

/**
 * In-document search over a Legislation PDF's own text layer — never a
 * reconstruction of the legislation, and never alters the document
 * itself. Text content for every page is read once, proactively, as
 * soon as the document opens (not only when the user types a search) so
 * the search box can honestly show "not searchable" immediately for a
 * scanned PDF rather than only after a confusing zero-result search.
 * `hasTextLayer` is derived from that real pass — the authoritative,
 * freshly-checked signal this viewer trusts, distinct from
 * `statutes.has_text_layer` (an upload-time hint only, never trusted
 * alone on its own — see that column's own comment, migration 0098).
 *
 * Matching is per text-item (not across item boundaries) — pdf.js emits
 * one item per contiguous run of same-style text, which in practice is
 * usually a full line or sentence, so this covers ordinary phrase search
 * correctly; a term split across a font/style change within a line is a
 * known, disclosed limitation of this pass, not a silent gap.
 */
export function usePdfSearch(doc: PdfjsDocument | null) {
  const [query, setQuery] = useState("");
  const [pagesText, setPagesText] = useState<PdfjsTextItem[][] | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [hasTextLayer, setHasTextLayer] = useState<boolean | null>(null);
  const [matches, setMatches] = useState<PdfMatch[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const loadingRef = useRef(false);

  const loadTextPass = useCallback(async (target: PdfjsDocument) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadingText(true);
    try {
      const pages: PdfjsTextItem[][] = [];
      let totalChars = 0;
      for (let i = 1; i <= target.numPages; i++) {
        const page = await target.getPage(i);
        const content = await page.getTextContent();
        const items = normalizeTextItems(content.items);
        totalChars += items.reduce((sum, it) => sum + it.str.length, 0);
        pages.push(items);
        page.cleanup();
      }
      setPagesText(pages);
      setHasTextLayer(totalChars >= MIN_DOCUMENT_TEXT_CHARS);
    } finally {
      loadingRef.current = false;
      setLoadingText(false);
    }
  }, []);

  // Reset on document change, then proactively run the text pass for the
  // new document (see file header for why this is eager, not lazy).
  useEffect(() => {
    setPagesText(null);
    setHasTextLayer(null);
    setQuery("");
    setMatches([]);
    setCurrentIndex(0);
    if (doc) void loadTextPass(doc);
  }, [doc, loadTextPass]);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q || !pagesText) {
      setMatches([]);
      setCurrentIndex(0);
      return;
    }
    const found: PdfMatch[] = [];
    pagesText.forEach((items, pageIndex) => {
      items.forEach((item, itemIndex) => {
        const lower = item.str.toLowerCase();
        let from = 0;
        for (;;) {
          const idx = lower.indexOf(q, from);
          if (idx === -1) break;
          found.push({ pageIndex, itemIndex, charStart: idx, charEnd: idx + q.length });
          from = idx + q.length;
        }
      });
    });
    setMatches(found);
    setCurrentIndex(0);
  }, [pagesText, query]);

  const next = useCallback(() => {
    setCurrentIndex((i) => (matches.length ? (i + 1) % matches.length : 0));
  }, [matches.length]);
  const prev = useCallback(() => {
    setCurrentIndex((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0));
  }, [matches.length]);
  const clear = useCallback(() => {
    setQuery("");
    setMatches([]);
    setCurrentIndex(0);
  }, []);

  return {
    query,
    setQuery,
    matches,
    currentIndex,
    currentMatch: matches[currentIndex] ?? null,
    next,
    prev,
    clear,
    /** True only while the initial per-document text pass is running (brief, once per open). */
    loadingText,
    /** null until the text pass completes; true/false is the authoritative, freshly-checked signal. */
    hasTextLayer,
    pagesText,
  };
}
