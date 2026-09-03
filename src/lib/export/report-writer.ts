import jsPDF from "jspdf";

export const PDF_MARGIN = 42;
export const PDF_PAGE_WIDTH = 595.28;
export const PDF_PAGE_HEIGHT = 841.89;
export const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
export const PDF_LINE = 13;

type JsPdfCtor = typeof jsPDF;

/** Node's jspdf build exports a namespace; Vite's browser build exports the class. */
const PdfCtor = (
  typeof jsPDF === "function" ? jsPDF : (jsPDF as unknown as { jsPDF: JsPdfCtor }).jsPDF
) as JsPdfCtor;

/** Shared jsPDF writer used by judgment and bench-note exports. */
export class PdfReportWriter {
  doc: InstanceType<JsPdfCtor>;
  y = PDF_MARGIN;

  constructor() {
    this.doc = new PdfCtor({ unit: "pt", format: "a4" });
    this.doc.setFont("helvetica", "normal");
  }

  ensureSpace(height: number) {
    if (this.y + height > PDF_PAGE_HEIGHT - PDF_MARGIN) {
      this.doc.addPage();
      this.y = PDF_MARGIN;
    }
  }

  text(str: string, opts: { size?: number; bold?: boolean; gap?: number; color?: number } = {}) {
    const size = opts.size ?? 10;
    this.doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    this.doc.setFontSize(size);
    this.doc.setTextColor(opts.color ?? 20);
    const lines = this.doc.splitTextToSize(str, PDF_CONTENT_WIDTH) as string[];
    this.ensureSpace(lines.length * PDF_LINE);
    for (const line of lines) {
      this.doc.text(line, PDF_MARGIN, this.y);
      this.y += PDF_LINE;
    }
    this.y += opts.gap ?? 0;
  }

  ruleLine(gapBefore = 4, gapAfter = 8) {
    this.y += gapBefore;
    this.ensureSpace(1);
    this.doc.setDrawColor(180);
    this.doc.line(PDF_MARGIN, this.y, PDF_PAGE_WIDTH - PDF_MARGIN, this.y);
    this.y += gapAfter;
  }

  footerPages() {
    const totalPages = this.doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      this.doc.setPage(p);
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(8);
      this.doc.setTextColor(140);
      this.doc.text(`Page ${p} of ${totalPages}`, PDF_PAGE_WIDTH - PDF_MARGIN, PDF_PAGE_HEIGHT - 20, {
        align: "right",
      });
    }
  }
}

export function safePdfFileName(stem: string): string {
  const cleaned = stem.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "export";
  return cleaned;
}
