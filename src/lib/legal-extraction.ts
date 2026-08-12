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

/**
 * Header/navigation fragments that real-world "print to PDF" law-report
 * pages commonly glue directly onto the case name with NO whitespace at
 * all (confirmed against the real Ramsingh PDF: extracted text began
 * "The State v Dhannie RamsinghOverview | (1973) 20 WIR 138..."). A
 * `\b`-bounded regex cannot see a token boundary between two glued
 * letters ("...inghOverview..." has no non-word character to anchor on),
 * so this is a deliberate case-insensitive substring search instead.
 * Kept short and curated — this is NOT a general "cut at any capital
 * letter" heuristic, which would mutilate legitimate party names.
 */
const CASE_NAME_NOISE_MARKERS = [
  "overview",
  "court of",
  "judgment",
  "headnote",
  "held:",
  "summary",
  "coram",
  "citation:",
  "download",
  "print |",
  "share |",
  "home |",
];

/** Trims a raw case-name candidate down to a clean "Party v Party" string, or returns undefined if it doesn't survive cleanup. Never used to invent a case name — only to clean one already found. */
function cleanCaseNameCandidate(raw: string): string | undefined {
  let candidate = raw;

  let cutAt = candidate.length;
  const lower = candidate.toLowerCase();
  for (const marker of CASE_NAME_NOISE_MARKERS) {
    const idx = lower.indexOf(marker);
    if (idx !== -1 && idx < cutAt) cutAt = idx;
  }
  candidate = candidate.slice(0, cutAt);

  // Defensive: also cut at any citation pattern that slipped into the
  // window (should be rare given how the window is chosen below, but
  // cheap to guard against).
  const citationInside = REPORTED_CITATION_RE.exec(candidate) ?? NEUTRAL_CITATION_RE.exec(candidate);
  if (citationInside && citationInside.index > 0) {
    candidate = candidate.slice(0, citationInside.index);
  }

  candidate = candidate.replace(/[|:\-–—]+$/, "").replace(/\s{2,}/g, " ").trim();
  if (!candidate || candidate.length < 5) return undefined;
  if (!/ v[s]?\.? /i.test(candidate)) return undefined;
  return candidate.length > 300 ? candidate.slice(0, 300).trim() : candidate;
}

/**
 * Locates a clean case-name candidate by preferring the text immediately
 * PRECEDING a citation occurrence over "the first line containing ' v '".
 * Real law-report headers commonly repeat the case title verbatim right
 * next to the formal citation (as the real Ramsingh PDF does: "...(1973)
 * 20 WIR 138The State v Dhannie Ramsingh (1973) 20 WIR 138COURT OF
 * APPEAL..." — the SECOND "Name (Year) Vol Rep Page" pairing is a much
 * cleaner boundary than the first, navigation-adjacent one). Scans every
 * citation occurrence found in `head`, latest first, and returns the
 * first one whose immediately-preceding text (bounded by the end of any
 * earlier citation, so two adjacent title/citation pairs never bleed
 * into each other) cleans up into a valid "Party v Party" string.
 */
function extractCaseName(head: string): string | undefined {
  const matches: { index: number; end: number }[] = [];
  for (const re of [REPORTED_CITATION_RE, NEUTRAL_CITATION_RE]) {
    const global = new RegExp(re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = global.exec(head))) {
      matches.push({ index: m.index, end: m.index + m[0].length });
      if (matches.length > 20) break; // safety cap against pathological input
    }
  }
  matches.sort((a, b) => a.index - b.index);

  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const prevEnd = i > 0 ? matches[i - 1].end : 0;
    const windowStart = Math.max(prevEnd, m.index - 200);
    const candidate = cleanCaseNameCandidate(head.slice(windowStart, m.index));
    if (candidate) return candidate;
  }

  // No citation-adjacent candidate found — fall back to the original
  // "first line containing ' v '" heuristic, still boundary-cleaned.
  const firstLine = head.split("\n").map((l) => l.trim()).find((l) => l.length > 3 && / v[s]?\.? /i.test(l));
  return firstLine ? cleanCaseNameCandidate(firstLine) : undefined;
}

/**
 * Decision-indicating language searched near a date candidate before it's
 * trusted as the decided date, rather than any date found anywhere in the
 * header — real judgments frequently print a cluster of HEARING dates
 * (e.g. "5, 6, 7, 9, 12, 14 February; 22 March 1973" — confirmed present
 * in the real Ramsingh PDF) that are not the decision date.
 */
const DECISION_CONTEXT_RE =
  /(judgment\s+delivered|delivered\s+on|delivered\s+judgment|date\s+of\s+judgment|decided\s+on|decision\s+delivered|judgment:|decided:)/i;

/**
 * Only proposes a decided date when a decision-indicating anchor (e.g.
 * "delivered on") appears near the date — never merely because A date
 * pattern exists somewhere in the header. §12: "Correct uncertainty is
 * preferable to incorrect metadata" — a judgment with several hearing
 * dates and no clear "delivered"/"decided" anchor is left blank rather
 * than guessing which date is the formal decision date.
 */
function extractDecidedDate(head: string): string | undefined {
  const global = new RegExp(DATE_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = global.exec(head))) {
    const context = head.slice(Math.max(0, m.index - 60), Math.min(head.length, m.index + m[0].length + 40));
    if (DECISION_CONTEXT_RE.test(context)) {
      const [, day, month, year] = m;
      const mm = MONTHS[month.toLowerCase()];
      if (mm) return `${year}-${mm}-${day.padStart(2, "0")}`;
    }
  }
  return undefined;
}

/** Best-effort, clearly-labeled-as-proposed extraction. Never invents a value it can't find — leaves fields undefined rather than guessing. */
export function extractCaseLawMetadata(text: string): ProposedCaseLawFields {
  const head = text.slice(0, 2000);
  const result: ProposedCaseLawFields = {};

  const caseName = extractCaseName(head);
  if (caseName) result.case_name = caseName;

  const neutral = head.match(NEUTRAL_CITATION_RE);
  if (neutral) result.neutral_citation = neutral[0];

  const reported = head.match(REPORTED_CITATION_RE);
  if (reported) result.reported_citation = reported[0];

  const decidedDate = extractDecidedDate(head);
  if (decidedDate) result.decided_date_guess = decidedDate;

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
