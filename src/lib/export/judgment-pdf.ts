import {
  PDF_PAGE_HEIGHT,
  PDF_PAGE_WIDTH,
  PdfReportWriter,
  safePdfFileName,
} from "@/lib/export/report-writer";

export interface JudgmentPdfInput {
  title: string;
  caseNumber: string | null;
  citation: string | null;
  courtName: string | null;
  judgmentDate: string | null;
  status: string;
  contentText: string | null;
  generatedAtLabel: string;
}

export const DRAFT_WATERMARK = "DRAFT: not finalised";

/**
 * Diagonal, low-contrast watermark on every page of a draft export, so a
 * printed or forwarded copy can never pass as the finalised judgment.
 * Drawn after the body so it sits over the text; light grey rather than a
 * transparency GState so it renders identically in every PDF viewer and
 * in the Node build used by test:export-pdf.
 */
function stampDraftWatermark(w: PdfReportWriter) {
  const totalPages = w.doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    w.doc.setPage(p);
    w.doc.setFont("helvetica", "bold");
    w.doc.setFontSize(48);
    w.doc.setTextColor(215);
    w.doc.text(DRAFT_WATERMARK, PDF_PAGE_WIDTH / 2, PDF_PAGE_HEIGHT / 2, {
      align: "center",
      angle: 40,
    });
  }
}

export function generateJudgmentPdf(input: JudgmentPdfInput) {
  const w = new PdfReportWriter();
  const isDraft = input.status === "draft";
  w.text("BENCHBOOK: MAGISTRATE WIZARD", { size: 9, bold: true, color: 100, gap: 2 });
  w.text(input.title, { size: 16, bold: true, gap: 6 });
  w.text(`Case number: ${input.caseNumber || "Not recorded"}`, { size: 10 });
  w.text(`Citation: ${input.citation || "Not recorded"}`, { size: 10 });
  w.text(`Court: ${input.courtName || "Not recorded"}`, { size: 10 });
  w.text(`Judgment date: ${input.judgmentDate || "Not recorded"}`, { size: 10 });
  w.text(`Status: ${isDraft ? "Draft (not finalised)" : input.status}`, { size: 10, gap: 4 });
  w.ruleLine();
  w.text("Body", { size: 12, bold: true, gap: 4 });
  w.text(input.contentText?.trim() ? input.contentText : "No body text recorded.", {
    size: 10,
    gap: 8,
  });
  w.ruleLine(4, 6);
  w.text(`Generated ${input.generatedAtLabel}`, { size: 8, color: 110 });
  if (isDraft) stampDraftWatermark(w);
  w.footerPages();
  return w.doc;
}

export function judgmentPdfFileName(title: string): string {
  return `${safePdfFileName(title)}.pdf`;
}
