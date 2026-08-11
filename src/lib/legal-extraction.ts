import { supabase } from "@/lib/supabase";
import { LEGAL_TAXONOMY_TOPICS } from "@/lib/legal-taxonomy";

/**
 * Deterministic (non-AI) extraction helpers for the Legal Library
 * ingestion pipeline. Everything here is plain JS text processing —
 * regex/heuristics/hashing — never a network call, never an LLM. This is
 * intentional: "do not use AI for tasks that deterministic processing can
 * reliably perform" (hashing, citation-pattern detection, section-number
 * parsing, date normalization, whitespace cleanup, keyword tagging).
 *
 * IMPORTANT HONESTY NOTE: there is no PDF/DOCX text-extraction library
 * available in this build (no npm registry access in this project's
 * sandbox to add pdfjs-dist or similar, and no verified server-side
 * extraction service). So "Document text" for a PDF/DOCX upload is
 * supplied by the curator (pasted, e.g. copied from the in-app PDF
 * viewer open alongside this form) rather than auto-extracted. A .txt
 * upload IS read automatically (see readFileAsText). Everything
 * DOWNSTREAM of having that text — hashing, structuring, classification,
 * duplicate detection — is fully automatic. This distinction is
 * surfaced in the ingestion UI, never silently glossed over.
 */

// ---------------------------------------------------------------------------
// Hashing (duplicate detection signal)
// ---------------------------------------------------------------------------

/** SHA-256 of a File's raw bytes, hex-encoded. Uses the browser's native Web Crypto API — no dependency. */
export async function sha256File(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return sha256Bytes(buffer);
}

/** SHA-256 of a text string (its UTF-8 bytes), hex-encoded. Used to fingerprint pasted/typed document text when no original file hash is available. */
export async function sha256Text(text: string): Promise<string> {
  const encoder = new TextEncoder();
  return sha256Bytes(encoder.encode(text.trim()).buffer);
}

async function sha256Bytes(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Reads a .txt file's contents as a string. Only reliable, automatic text source available client-side (no PDF/DOCX parser in this build — see file header). */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.readAsText(file);
  });
}

// ---------------------------------------------------------------------------
// Whitespace / normalization
// ---------------------------------------------------------------------------

/** Collapses runs of blank lines/trailing spaces without touching intentional paragraph breaks — a light deterministic cleanup pass, not a rewrite. */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Case Law: proposed metadata (never silently committed — always presented
// as editable suggestions in the Review Queue).
// ---------------------------------------------------------------------------

export interface ProposedCaseLawFields {
  case_name?: string;
  neutral_citation?: string;
  reported_citation?: string;
  decided_date_guess?: string;
}

const NEUTRAL_CITATION_RE = /\[(\d{4})\]\s?[A-Z]{2,10}\s?\d+/;
const REPORTED_CITATION_RE = /\(\d{4}\)\s?\d+\s?[A-Z][A-Za-z.]*\s?\d+/;
const DATE_RE =
  /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i;

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

/** Best-effort, clearly-labeled-as-proposed extraction. Never invents a value it can't find — leaves fields undefined rather than guessing. */
export function extractCaseLawMetadata(text: string): ProposedCaseLawFields {
  const head = text.slice(0, 2000);
  const result: ProposedCaseLawFields = {};

  const firstLine = head.split("\n").map((l) => l.trim()).find((l) => l.length > 3);
  if (firstLine && / v[s]?\.? /i.test(firstLine)) {
    result.case_name = firstLine.replace(/\s{2,}/g, " ").slice(0, 300);
  }

  const neutral = head.match(NEUTRAL_CITATION_RE);
  if (neutral) result.neutral_citation = neutral[0];

  const reported = head.match(REPORTED_CITATION_RE);
  if (reported) result.reported_citation = reported[0];

  const dateMatch = head.match(DATE_RE);
  if (dateMatch) {
    const [, day, month, year] = dateMatch;
    const mm = MONTHS[month.toLowerCase()];
    if (mm) result.decided_date_guess = `${year}-${mm}-${day.padStart(2, "0")}`;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Legislation: best-effort structural (Part/Chapter/Section/Subsection/
// Paragraph/Schedule) parse from plain text. Always editable before
// publish — numbering/headings are preserved exactly as matched, never
// re-derived.
// ---------------------------------------------------------------------------

export interface ProposedProvision {
  level: "part" | "chapter" | "section" | "subsection" | "paragraph" | "schedule";
  number: string;
  heading: string | null;
  body_text: string | null;
  sort_order: number;
}

const LINE_PATTERNS: { level: ProposedProvision["level"]; re: RegExp }[] = [
  { level: "schedule", re: /^SCHEDULE\s*([0-9A-Z]*)\s*(.*)$/i },
  { level: "part", re: /^PART\s+([IVXLC]+|\d+[A-Z]?)\s*[-–—.:]?\s*(.*)$/i },
  { level: "chapter", re: /^CHAPTER\s+([IVXLC]+|\d+[A-Z]?)\s*[-–—.:]?\s*(.*)$/i },
  // "4. Short title" or "4 Short title" (top-level numbered section)
  { level: "section", re: /^(\d{1,3}[A-Z]?)\.\s+(.+)$/ },
  // "(1) Subject to..." (parenthetical subsection at start of line)
  { level: "subsection", re: /^\((\d{1,3}[a-z]?)\)\s*(.*)$/ },
];

/**
 * Line-based, deterministic best-effort parser. Not a full statutory
 * grammar — jurisdictions vary too much for that to be reliable — but a
 * genuinely useful first pass a curator edits rather than building a
 * provision tree entirely by hand. Any line that doesn't match a heading
 * pattern is appended to the body_text of the most recently opened
 * provision (falling back to a single top-level "section" wrapper if the
 * document has no recognizable headings at all, so text is never
 * silently dropped).
 */
export function extractLegislationHierarchy(text: string): ProposedProvision[] {
  const lines = normalizeWhitespace(text).split("\n");
  const provisions: ProposedProvision[] = [];
  let current: ProposedProvision | null = null;
  let order = 0;

  function openProvision(level: ProposedProvision["level"], number: string, heading: string) {
    current = {
      level,
      number: number.trim(),
      heading: heading.trim() || null,
      body_text: null,
      sort_order: order++,
    };
    provisions.push(current);
  }

  function appendBody(line: string) {
    if (!current) {
      openProvision("section", "1", "");
    }
    const c = current as ProposedProvision;
    c.body_text = c.body_text ? `${c.body_text}\n${line}` : line;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let matched = false;
    for (const { level, re } of LINE_PATTERNS) {
      const m = line.match(re);
      if (m) {
        openProvision(level, m[1] ?? "", m[2] ?? "");
        matched = true;
        break;
      }
    }
    if (!matched) appendBody(line);
  }

  return provisions.map((p) => ({ ...p, body_text: p.body_text?.trim() || null }));
}

// ---------------------------------------------------------------------------
// Canonical tag proposal (keyword match against the existing curated
// taxonomy — src/lib/legal-taxonomy.ts). NOT AI. A simple case-insensitive
// substring match, capped, deduplicated. Clearly a heuristic, not a
// classifier — presented as proposed tags only.
// ---------------------------------------------------------------------------

export function proposeTags(text: string, limit = 10): string[] {
  const lower = text.toLowerCase();
  const hits = LEGAL_TAXONOMY_TOPICS.filter((topic) => lower.includes(topic.toLowerCase()));
  return Array.from(new Set(hits)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Duplicate detection — strong signals (hash, citation) checked first;
// weak signals (normalized title/case name) surfaced as a warning only.
// Never auto-merges; always returns for the curator to judge.
// ---------------------------------------------------------------------------

export interface DuplicateWarning {
  strength: "strong" | "possible";
  reason: string;
  existingId: string;
  existingLabel: string;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export async function findCaseLawDuplicates(params: {
  documentHash?: string;
  neutralCitation?: string;
  caseName?: string;
  court?: string;
}): Promise<DuplicateWarning[]> {
  const warnings: DuplicateWarning[] = [];

  if (params.documentHash) {
    const { data } = await supabase
      .from("case_law")
      .select("id, case_name, citation")
      .eq("document_hash", params.documentHash)
      .limit(3);
    for (const row of data ?? []) {
      warnings.push({
        strength: "strong",
        reason: "Identical document hash already on record.",
        existingId: row.id,
        existingLabel: `${row.case_name} (${row.citation})`,
      });
    }
  }

  if (params.neutralCitation) {
    const { data } = await supabase
      .from("case_law")
      .select("id, case_name, citation")
      .eq("neutral_citation", params.neutralCitation)
      .limit(3);
    for (const row of data ?? []) {
      if (warnings.some((w) => w.existingId === row.id)) continue;
      warnings.push({
        strength: "strong",
        reason: "Matching neutral citation already on record.",
        existingId: row.id,
        existingLabel: `${row.case_name} (${row.citation})`,
      });
    }
  }

  if (params.caseName && params.court && warnings.length === 0) {
    const { data } = await supabase
      .from("case_law")
      .select("id, case_name, citation, court")
      .ilike("case_name", `%${params.caseName.slice(0, 40)}%`)
      .limit(5);
    for (const row of data ?? []) {
      if (normalize(row.case_name) === normalize(params.caseName) && row.court === params.court) {
        warnings.push({
          strength: "possible",
          reason: "Similar case name and court already on record.",
          existingId: row.id,
          existingLabel: `${row.case_name} (${row.citation})`,
        });
      }
    }
  }

  return warnings;
}

export async function findStatuteDuplicates(params: {
  documentHash?: string;
  title?: string;
  chapterNumber?: string;
  actNumber?: string;
  jurisdiction?: string;
}): Promise<DuplicateWarning[]> {
  const warnings: DuplicateWarning[] = [];

  if (params.documentHash) {
    const { data } = await supabase
      .from("statutes")
      .select("id, title, code")
      .eq("document_hash", params.documentHash)
      .limit(3);
    for (const row of data ?? []) {
      warnings.push({
        strength: "strong",
        reason: "Identical document hash already on record.",
        existingId: row.id,
        existingLabel: `${row.title} (${row.code})`,
      });
    }
  }

  if (params.chapterNumber || params.actNumber) {
    const { data } = await supabase
      .from("statutes")
      .select("id, title, code, chapter_number, act_number, jurisdiction")
      .eq("jurisdiction", params.jurisdiction ?? "")
      .limit(20);
    for (const row of data ?? []) {
      if (warnings.some((w) => w.existingId === row.id)) continue;
      const chapterMatches =
        params.chapterNumber && row.chapter_number && row.chapter_number === params.chapterNumber;
      const actMatches = params.actNumber && row.act_number && row.act_number === params.actNumber;
      if (chapterMatches || actMatches) {
        warnings.push({
          strength: "strong",
          reason: chapterMatches
            ? "Matching chapter number in this jurisdiction already on record."
            : "Matching Act number in this jurisdiction already on record.",
          existingId: row.id,
          existingLabel: `${row.title} (${row.code})`,
        });
      }
    }
  }

  if (params.title && warnings.length === 0) {
    const { data } = await supabase
      .from("statutes")
      .select("id, title, code")
      .ilike("title", `%${params.title.slice(0, 40)}%`)
      .limit(5);
    for (const row of data ?? []) {
      if (normalize(row.title) === normalize(params.title)) {
        warnings.push({
          strength: "possible",
          reason: "Similar title already on record.",
          existingId: row.id,
          existingLabel: `${row.title} (${row.code})`,
        });
      }
    }
  }

  return warnings;
}
