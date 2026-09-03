import { PdfReportWriter, safePdfFileName } from "@/lib/export/report-writer";

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

export function generateJudgmentPdf(input: JudgmentPdfInput) {
  const w = new PdfReportWriter();
  w.text("BENCHBOOK: MAGISTRATE WIZARD", { size: 9, bold: true, color: 100, gap: 2 });
  w.text(input.title, { size: 16, bold: true, gap: 6 });
  w.text(`Case number: ${input.caseNumber || "Not recorded"}`, { size: 10 });
  w.text(`Citation: ${input.citation || "Not recorded"}`, { size: 10 });
  w.text(`Court: ${input.courtName || "Not recorded"}`, { size: 10 });
  w.text(`Judgment date: ${input.judgmentDate || "Not recorded"}`, { size: 10 });
  w.text(`Status: ${input.status}`, { size: 10, gap: 4 });
  w.ruleLine();
  w.text("Body", { size: 12, bold: true, gap: 4 });
  w.text(input.contentText?.trim() ? input.contentText : "No body text recorded.", { size: 10, gap: 8 });
  w.ruleLine(4, 6);
  w.text(`Generated ${input.generatedAtLabel}`, { size: 8, color: 110 });
  w.footerPages();
  return w.doc;
}

export function judgmentPdfFileName(title: string): string {
  return `${safePdfFileName(title)}.pdf`;
}
