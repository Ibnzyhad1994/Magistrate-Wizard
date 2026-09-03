import { PdfReportWriter, safePdfFileName } from "@/lib/export/report-writer";

export interface BenchNotePdfInput {
  title: string;
  parentLabel: string | null;
  status: string;
  contentText: string | null;
  generatedAtLabel: string;
}

export function generateBenchNotePdf(input: BenchNotePdfInput) {
  const w = new PdfReportWriter();
  w.text("BENCHBOOK: MAGISTRATE WIZARD", { size: 9, bold: true, color: 100, gap: 2 });
  w.text(input.title, { size: 16, bold: true, gap: 6 });
  w.text(`Related: ${input.parentLabel || "Not recorded"}`, { size: 10 });
  w.text(`Status: ${input.status}`, { size: 10, gap: 4 });
  w.ruleLine();
  w.text("Note", { size: 12, bold: true, gap: 4 });
  w.text(input.contentText?.trim() ? input.contentText : "No body text recorded.", { size: 10, gap: 8 });
  w.ruleLine(4, 6);
  w.text(`Generated ${input.generatedAtLabel}`, { size: 8, color: 110 });
  w.footerPages();
  return w.doc;
}

export function benchNotePdfFileName(title: string): string {
  return `${safePdfFileName(title)}.pdf`;
}
