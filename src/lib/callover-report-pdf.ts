import type jsPDF from "jspdf";
import { CONTENT_WIDTH, LINE, MARGIN, ReportWriter } from "@/lib/docket-report-pdf";
import { PROCEDURE_STAGE_LABELS, type ProcedureStage } from "@/lib/docket-procedure";

/**
 * The callover record: what was called, in what order, and what was
 * decided. Reuses ReportWriter (docket-report-pdf.ts) so the two reports
 * share one page geometry and typography rather than drifting apart.
 *
 * Deliberately a flat, scannable list rather than the Daily Progress
 * Report's per-matter blocks — a callover of thirty matters is read as a
 * roll, and one line per matter is what makes it usable on the bench.
 */

export type CalloverReportRow = {
  sort_order: number;
  called_at: string | null;
  outcome: string | null;
  next_date: string | null;
  notes: string | null;
  docket_matters: {
    case_number: string;
    matter_title: string;
    procedure_stage: string | null;
    brought_forward_from: string | null;
  } | null;
};

export type CalloverReportMeta = {
  title: string;
  dateLabel: string;
  courtName: string | null;
  magistrateName: string | null;
  generatedAtLabel: string;
  calledCount: number;
  totalCount: number;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function generateCalloverReportPdf(
  rows: CalloverReportRow[],
  meta: CalloverReportMeta,
): jsPDF {
  const w = new ReportWriter();

  w.text("BENCHBOOK: MAGISTRATE WIZARD", { size: 9, bold: true, color: 100, gap: 2 });
  w.text(meta.title, { size: 16, bold: true, gap: 2 });
  w.ruleLine();

  w.keyValueRow([
    ["Sitting date", meta.dateLabel],
    ["Court", meta.courtName ?? "—"],
  ]);
  w.keyValueRow([
    ["Presiding", meta.magistrateName ?? "—"],
    ["Called", `${meta.calledCount} of ${meta.totalCount}`],
  ]);
  w.ruleLine();

  // Column geometry, shared by the heading and every row so they stay
  // aligned across page breaks.
  const cols = [
    { label: "#", x: MARGIN, width: 20 },
    { label: "Case", x: MARGIN + 20, width: 110 },
    { label: "Matter", x: MARGIN + 130, width: 150 },
    { label: "Stage", x: MARGIN + 280, width: 70 },
    { label: "Outcome", x: MARGIN + 350, width: 90 },
    { label: "Next date", x: MARGIN + 440, width: CONTENT_WIDTH - 440 },
  ];

  function heading() {
    w.ensureSpace(LINE + 6);
    w.doc.setFont("helvetica", "bold");
    w.doc.setFontSize(8);
    w.doc.setTextColor(110);
    for (const c of cols) w.doc.text(c.label.toUpperCase(), c.x, w.y);
    w.y += LINE;
  }

  heading();

  rows.forEach((row, index) => {
    const matter = row.docket_matters;
    const stage = (matter?.procedure_stage ?? null) as ProcedureStage | null;

    const cells = [
      String(row.sort_order || index + 1),
      matter?.case_number ?? "—",
      matter?.matter_title ?? "—",
      stage ? PROCEDURE_STAGE_LABELS[stage] : "—",
      row.outcome ?? (row.called_at ? "Called" : "Not called"),
      fmtDate(row.next_date),
    ];

    // Wrap every cell first so the row's own height accounts for the
    // longest one, then decide whether it fits on this page. Splitting a
    // matter's line across a page break would make the roll unreadable.
    const wrapped = cells.map((text, i) =>
      w.doc.splitTextToSize(text, cols[i].width - 6) as string[],
    );
    const rowLines = Math.max(...wrapped.map((lines) => lines.length));
    const rowHeight = rowLines * LINE;

    if (w.y + rowHeight > 841.89 - MARGIN) {
      w.doc.addPage();
      w.y = MARGIN;
      heading();
    }

    w.doc.setFont("helvetica", "normal");
    w.doc.setFontSize(9);
    w.doc.setTextColor(20);
    wrapped.forEach((lines, i) => {
      w.doc.text(lines, cols[i].x, w.y);
    });
    w.y += rowHeight;

    const extras: string[] = [];
    if (matter?.brought_forward_from) extras.push(`Brought forward from ${matter.brought_forward_from}`);
    if (row.notes) extras.push(row.notes);
    if (extras.length > 0) {
      w.doc.setFontSize(8);
      w.doc.setTextColor(110);
      const noteLines = w.doc.splitTextToSize(extras.join(" · "), CONTENT_WIDTH - 26) as string[];
      w.ensureSpace(noteLines.length * LINE);
      w.doc.text(noteLines, MARGIN + 20, w.y);
      w.y += noteLines.length * LINE;
    }

    w.y += 3;
  });

  w.ruleLine(6, 8);
  w.text(`Generated ${meta.generatedAtLabel}`, { size: 8, color: 120 });

  return w.doc;
}

export function calloverReportFileName(dateStr: string, courtName: string | null): string {
  const court = courtName ? `-${courtName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}` : "";
  return `callover-${dateStr}${court}.pdf`;
}
