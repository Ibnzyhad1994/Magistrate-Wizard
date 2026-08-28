import { useCallback, useEffect, useRef, useState } from "react";
import { downloadDocumentBlob } from "@/hooks/use-documents";
import { loadLegislationPdf, type PdfjsDocument } from "@/lib/legislation-pdf";

export type PdfDocumentState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; doc: PdfjsDocument; numPages: number }
  | { status: "error"; error: unknown };

/**
 * Loads a Legislation PDF for the viewer, given its Storage `file_path`.
 * Bytes come through the authenticated Storage API (`downloadDocumentBlob`
 * — RLS re-checked on every request), not a signed URL, matching this
 * app's existing preference (see that function's own comment). Destroys
 * the pdfjs document on unmount/path change so a long viewing session
 * never accumulates more than one open document in memory.
 */
export function usePdfDocument(filePath: string | null) {
  const [state, setState] = useState<PdfDocumentState>({ status: "idle" });
  const [reloadToken, setReloadToken] = useState(0);
  const docRef = useRef<PdfjsDocument | null>(null);

  useEffect(() => {
    if (!filePath) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      const blob = await downloadDocumentBlob(filePath);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const doc = await loadLegislationPdf(bytes);
      if (cancelled) {
        void doc.destroy();
        return;
      }
      docRef.current = doc;
      setState({ status: "ready", doc, numPages: doc.numPages });
    })().catch((error: unknown) => {
      if (!cancelled) setState({ status: "error", error });
    });
    return () => {
      cancelled = true;
      if (docRef.current) {
        void docRef.current.destroy();
        docRef.current = null;
      }
    };
  }, [filePath, reloadToken]);

  const retry = useCallback(() => setReloadToken((t) => t + 1), []);

  return { ...state, retry };
}
