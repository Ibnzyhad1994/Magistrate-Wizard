import jsPDF from "jspdf";
import type { DailyDocketReportRow } from "@/hooks/docket/use-daily-docket-report";
import { PROCEDURE_VALUE_LABELS } from "@/lib/docket-procedure";
import { toTitleCase } from "@/lib/utils";

/**
 * Daily Docket Progress Report — a professional, print-safe PDF for one
 * Docket date. Restrained layout deliberately: no colour-dependent
 * design, no decorative graphics, readable in grayscale and on paper.
 * Built directly with jsPDF (new dependency — no PDF-generation library
 * existed in this project; pdfjs-dist is a reader, not a writer).
 *
 * Every figure here is computed from get_daily_docket_report_data
 * (0080/0081) — nothing is invented. A field the system doesn't
 * currently record (bail amount — no such column exists anywhere in the
 * schema) always renders as "Not recorded" rather than being guessed or
 * silently omitted.
 */

const MARGIN = 42;
const PAGE_WIDTH = 595.28; // A4 at 72dpi-equivalent pt
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE = 13;

interface ReportMeta {
  dateLabel: string;
  courtName: string | null;
  districtName: string | null;
  magistrateName: string | null;
  generatedAtLabel: string;
}

function appearanceStatusLabel(status: string | null): string {
  switch (status) {
    case "scheduled":
      return "Scheduled";
    case "completed":
      return "Heard / Adjourned";
    case "cancelled":
      return "Rescheduled";
    default:
      return "Not recorded";
  }
}

class ReportWriter {
  doc: jsPDF;
  y = MARGIN;

  constructor() {
    this.doc = new jsPDF({ unit: "pt", format: "a4" });
    this.doc.setFont("helvetica", "normal");
  }

  ensureSpace(height: number) {
    if (this.y + height > PAGE_HEIGHT - MARGIN) {
      this.doc.addPage();
      this.y = MARGIN;
    }
  }

  text(str: string, opts: { size?: number; bold?: boolean; gap?: number; color?: number } = {}) {
    const size = opts.size ?? 10;
    this.doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    this.doc.setFontSize(size);
    this.doc.setTextColor(opts.color ?? 20);
    const lines = this.doc.splitTextToSize(str, CONTENT_WIDTH) as string[];
    this.ensureSpace(lines.length * LINE);
    for (const line of lines) {
      this.doc.text(line, MARGIN, this.y);
      this.y += LINE;
    }
    this.y += opts.gap ?? 0;
  }

  ruleLine(gapBefore = 4, gapAfter = 8) {
    this.y += gapBefore;
    this.ensureSpace(1);
    this.doc.setDrawColor(180);
    this.doc.line(MARGIN, this.y, PAGE_WIDTH - MARGIN, this.y);
    this.y += gapAfter;
  }

  keyValueRow(pairs: [string, string][]) {
    const colWidth = CONTENT_WIDTH / pairs.length;
    this.ensureSpace(LINE + 2);
    pairs.forEach(([label, value], i) => {
      const x = MARGIN + i * colWidth;
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(8);
      this.doc.setTextColor(110);
      this.doc.text(label.toUpperCase(), x, this.y);
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(10);
      this.doc.setTextColor(20);
      const valueLines = this.doc.splitTextToSize(value, colWidth - 6) as string[];
      this.doc.text(valueLines, x, this.y + 12);
    });
    this.y += 30;
  }
}

function estimateMatterHeight(row: DailyDocketReportRow): number {
  // Rough but sufficient estimate to decide whether to start a fresh
  // page rather than split a matter's heading from its own content.
  let lines = 6; // heading + case info + stage/status line + custody line
  if (row.appearance_status && (row.witnesses_called != null || row.witnesses_completed != null)) lines += 2;
  if (row.outcome_at_event) lines += 2;
  if (row.notes) lines += 2;
  if (row.orders_summary || row.outcome) lines += 2;
  lines += 1; // next date
  return lines * LINE + 20;
}

export function generateDailyDocketReportPdf(rows: DailyDocketReportRow[], meta: ReportMeta): jsPDF {
  const w = new ReportWriter();

  // ---- Header ----
  w.text("BENCHBOOK: MAGISTRATE WIZARD", { size: 9, bold: true, color: 100, gap: 2 });
  w.text("Daily Docket Progress Report", { size: 16, bold: true, gap: 6 });
  w.keyValueRow([
    ["Date", meta.dateLabel],
    ["Court", meta.courtName ?? "Multiple courts"],
    ["Magisterial District", meta.districtName ?? "Not recorded"],
  ]);
  w.keyValueRow([
    ["Magistrate", meta.magistrateName ?? "Not recorded"],
    ["Generated", meta.generatedAtLabel],
    ["Total matters", String(rows.length)],
  ]);
  w.ruleLine();

  // ---- Daily Summary ----
  w.text("Daily Summary", { size: 12, bold: true, gap: 4 });

  const byCategory = new Map<string, number>();
  for (const r of rows) {
    const key = r.category_name ?? "No category recorded";
    byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
  }
  const byStatus = new Map<string, number>();
  for (const r of rows) {
    const key = appearanceStatusLabel(r.appearance_status);
    byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
  }
  const withCompleted = rows.filter((r) => r.witnesses_completed != null);
  const totalCompleted = withCompleted.length
    ? withCompleted.reduce((sum, r) => sum + (r.witnesses_completed as number), 0)
    : null;
  const withPartlyHeard = rows.filter((r) => r.witnesses_partly_heard != null);
  const totalPartlyHeard = withPartlyHeard.length
    ? withPartlyHeard.reduce((sum, r) => sum + (r.witnesses_partly_heard as number), 0)
    : null;

  w.text(`Total matters listed: ${rows.length}`, { size: 10 });
  for (const [name, count] of byCategory) {
    w.text(`  ${name}: ${count}`, { size: 10 });
  }
  w.text("", { size: 4 });
  for (const [label, count] of byStatus) {
    w.text(`${label}: ${count}`, { size: 10 });
  }
  w.text("", { size: 4 });
  w.text(
    `Witnesses completed (across matters with data recorded): ${totalCompleted != null ? totalCompleted : "Not recorded"}`,
    { size: 10 },
  );
  w.text(
    `Witnesses partly heard (across matters with data recorded): ${totalPartlyHeard != null ? totalPartlyHeard : "Not recorded"}`,
    { size: 10 },
  );
  w.ruleLine(10, 12);

  // ---- Individual matters, in the same deterministic order the RPC
  // returns them (case_number, matter_title) — never re-sorted here. ----
  rows.forEach((row, i) => {
    w.ensureSpace(estimateMatterHeight(row));

    w.text(`${i + 1}. ${row.matter_title}`, { size: 12, bold: true, gap: 2 });

    const parties = (Array.isArray(row.parties) ? row.parties : []) as { full_name: string; role: string }[];
    const partiesLine = parties.length
      ? parties.map((p) => `${toTitleCase(p.role)}: ${p.full_name}`).join("  ·  ")
      : null;

    w.text(`Case Jacket No: ${row.case_number}`, { size: 10 });
    w.text(`Court: ${row.court_name ?? "Not recorded"}`, { size: 10 });
    if (row.charge_or_issue) w.text(`Charge / issue: ${row.charge_or_issue}`, { size: 10 });
    if (partiesLine) w.text(partiesLine, { size: 10 });
    w.text(
      `Stage: ${row.appearance_stage ?? toTitleCase(row.procedure_stage)}    Status: ${toTitleCase(row.status)}    Appearance: ${appearanceStatusLabel(row.appearance_status)}`,
      { size: 10 },
    );
    w.text(
      `Custody: ${row.custody_status && row.custody_status !== "unset" ? (PROCEDURE_VALUE_LABELS[row.custody_status] ?? toTitleCase(row.custody_status)) : "Not recorded"}    Bail amount: Not recorded`,
      { size: 10, gap: 4 },
    );

    w.text("Proceedings", { size: 10, bold: true });
    const hasWitnessData =
      row.witnesses_called != null ||
      row.witnesses_completed != null ||
      row.witnesses_partly_heard != null ||
      row.witnesses_remaining != null;
    if (hasWitnessData) {
      w.text(
        `Witnesses called: ${row.witnesses_called ?? "Not recorded"}    Completed: ${row.witnesses_completed ?? "Not recorded"}    Partly heard: ${row.witnesses_partly_heard ?? "Not recorded"}    Remaining: ${row.witnesses_remaining ?? "Not recorded"}`,
        { size: 10 },
      );
    }
    w.text(`Proceedings note: ${row.notes || row.outcome_at_event || "Not recorded"}`, { size: 10, gap: 4 });

    w.text("Orders / Outcome", { size: 10, bold: true });
    w.text(`Orders: ${row.orders_summary || "None recorded"}`, { size: 10 });
    w.text(`Outcome: ${row.outcome || "None recorded"}`, { size: 10, gap: 4 });

    w.text(`Next Date: ${row.next_appearance ? formatReportDate(row.next_appearance) : "Not recorded"}`, {
      size: 10,
      gap: 10,
    });

    if (i < rows.length - 1) w.ruleLine(0, 10);
  });

  // ---- Page numbers ----
  const totalPages = w.doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    w.doc.setPage(p);
    w.doc.setFont("helvetica", "normal");
    w.doc.setFontSize(8);
    w.doc.setTextColor(140);
    w.doc.text(`Page ${p} of ${totalPages}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 20, { align: "right" });
  }

  return w.doc;
}

function formatReportDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** `Docket-Progress-Report_<Court>_<date>.pdf`, filesystem-safe. */
export function reportFileName(dateStr: string, courtName: string | null): string {
  const safeCourt = courtName ? `_${courtName.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "")}` : "";
  return `Docket-Progress-Report${safeCourt}_${dateStr}.pdf`;
}
