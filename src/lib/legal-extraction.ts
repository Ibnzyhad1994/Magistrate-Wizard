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

/**
 * A "pincite" — a page/paragraph reference INTO a citation (e.g. "at 142",
 * "at p. 42", "at para 6") — is a hallmark of a BODY reference to some
 * other case ("...the decision at 142 R v Someone Else (1967)..."), never
 * of a genuine document header. Generic across every jurisdiction (this
 * is standard common-law citation practice, not specific to any one
 * court/reporter series), so cutting the candidate window here is not a
 * fixture-specific hack.
 */
const PINCITE_RE = /\bat\s+(p\.?\s*|page\s+|para\.?\s*|paras?\.?\s*)?\d{1,4}\b/i;

/**
 * Generic signals that a citation-adjacent text window is a BODY
 * reference to some OTHER case (a cited authority, a "see also", a digest
 * entry) rather than the document's own header — confirmed by the real
 * Task 4 regression ("at 142R v Ferguson and Willoughby..." was proposed
 * as the case name because it was simply the LAST citation-adjacent
 * window found, with no signal distinguishing "this is a citation the
 * judgment is discussing" from "this is the judgment's own title").
 * Deliberately generic phrases every common-law judgment might use when
 * citing other authorities — never a party name, citation, or
 * jurisdiction name.
 */
const BODY_REFERENCE_MARKERS = [
  "see also",
  "see ",
  "cf.",
  "cf ",
  "supra",
  "ibid",
  "digest",
  "cited in",
  "reported at",
  "noted at",
  "following ",
  "applying ",
  "distinguishing ",
  "referred to",
  "considered in",
  "the decision",
  "the authority",
  "the case of",
  "the earlier",
];

/**
 * Sentence-continuation connectors — a genuine case-name/party string
 * never legitimately starts with one of these; their presence means the
 * window began mid-sentence, not at a title. Deliberately EXCLUDES "The"/
 * "This"/"That"/"It" — extremely common genuine case-name openings in
 * Commonwealth practice ("The State v...", "The Queen v...", "The King
 * v...", "The Attorney General v...") must never be disqualified by this
 * check.
 */
const CONTINUATION_START_RE = /^(and|also|further|moreover|in addition|likewise|similarly|but|however|thus|hence|therefore)\b/i;

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

  // Cut at a pincite reference ("at 142", "at p. 42") that slipped into
  // the window — a genuine title never contains one of these.
  const pinciteInside = PINCITE_RE.exec(candidate);
  if (pinciteInside && pinciteInside.index > 0) {
    candidate = candidate.slice(0, pinciteInside.index);
  }

  candidate = candidate.replace(/[|:\-–—]+$/, "").replace(/\s{2,}/g, " ").trim();
  // Strip a leading fragment up to the last sentence-ending punctuation —
  // a window that starts mid-sentence (bounded only by a fixed character
  // count, not a real boundary) commonly carries a trailing clause from
  // the previous sentence ahead of the true candidate start.
  const lastBoundary = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("; "), candidate.lastIndexOf("\n"));
  if (lastBoundary !== -1 && lastBoundary < candidate.length - 5) {
    candidate = candidate.slice(lastBoundary + 2).trim();
  }
  if (!candidate || candidate.length < 5) return undefined;
  if (!/ v[s]?\.? /i.test(candidate)) return undefined;
  return candidate.length > 300 ? candidate.slice(0, 300).trim() : candidate;
}

/**
 * Structural scoring for a cleaned case-name candidate — does it look
 * like a genuine document TITLE, or a body reference to some OTHER case?
 * Deliberately content-agnostic: every signal here is about SHAPE
 * (starting letter case, connector words, count of " v " occurrences,
 * known body-reference phrasing, distance from document start), never a
 * specific party/court/citation string. Returns `disqualified: true` for
 * a hard structural red flag (never proposed, regardless of how early it
 * appears); otherwise a `positionScore` where smaller `citationIndex`
 * (closer to the start of the document) is preferred, matching how real
 * judgment headers are laid out.
 */
function scoreCaseNameCandidate(candidate: string, citationIndex: number): { disqualified: boolean; positionScore: number } {
  const lower = candidate.toLowerCase();
  let disqualified = false;

  if (BODY_REFERENCE_MARKERS.some((marker) => lower.includes(marker))) disqualified = true;
  if (CONTINUATION_START_RE.test(candidate.trim())) disqualified = true;
  // A genuine case name / party string starts with a capital letter, a
  // digit (rare but possible), or an opening quote/bracket — never a
  // lowercase letter (which means the window began mid-word/mid-sentence,
  // e.g. the observed "at 142R v Ferguson..." fragment).
  if (/^[a-z]/.test(candidate.trim())) disqualified = true;
  // More than one " v "/" vs " inside a single candidate suggests several
  // distinct citations/party pairs got concatenated (a digest-style list
  // of authorities), not one case's own name.
  const vCount = (lower.match(/\sv[s]?\.?\s/g) ?? []).length;
  if (vCount > 1) disqualified = true;

  return { disqualified, positionScore: -citationIndex };
}

/**
 * Locates a clean case-name candidate by scoring EVERY citation-adjacent
 * text window in `head`, not just returning the first (or last) one that
 * happens to clean up into a valid "Party v Party" string. Real law-report
 * headers commonly repeat the case title verbatim right next to the
 * formal citation (confirmed against the real Ramsingh PDF), and real
 * judgments commonly cite several OTHER authorities within the same
 * ~2000-character head window (confirmed by the real Task 4 regression,
 * where a body citation — "at 142 R v Ferguson and Willoughby..." — was
 * proposed instead of the genuine header). Candidates are disqualified by
 * generic structural red flags (see scoreCaseNameCandidate) and, among
 * survivors, the one closest to the start of the document wins — never a
 * fixture-specific rule.
 */
interface CaseNameCandidateResult {
  name: string;
  /** Character offset (within `head`) of the citation this name was anchored to — the primary confidence signal (Task 4, Phase 3): a name anchored very close to the document start is far more likely to be the genuine header than one anchored deep into the head window. `null` when found via the citation-independent fallback path (no anchor at all — always treated as low confidence). */
  citationIndex: number | null;
  /** The exact citation text this name was paired with — reused by extractCaseLawMetadata so the proposed citation field is genuinely the SAME citation the case name was validated against, not an independently (and possibly differently) matched one. */
  citationText: string | null;
  citationType: "reported" | "neutral" | null;
}

function extractCaseNameCandidate(head: string): CaseNameCandidateResult | undefined {
  const matches: { index: number; end: number; text: string; type: "reported" | "neutral" }[] = [];
  for (const { re, type } of [
    { re: REPORTED_CITATION_RE, type: "reported" as const },
    { re: NEUTRAL_CITATION_RE, type: "neutral" as const },
  ]) {
    const global = new RegExp(re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = global.exec(head))) {
      matches.push({ index: m.index, end: m.index + m[0].length, text: m[0], type });
      if (matches.length > 20) break; // safety cap against pathological input
    }
  }
  matches.sort((a, b) => a.index - b.index);

  const survivors: { candidate: string; positionScore: number; match: (typeof matches)[number] }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const prevEnd = i > 0 ? matches[i - 1].end : 0;
    const windowStart = Math.max(prevEnd, m.index - 200);
    const candidate = cleanCaseNameCandidate(head.slice(windowStart, m.index));
    if (!candidate) continue;
    const { disqualified, positionScore } = scoreCaseNameCandidate(candidate, m.index);
    if (disqualified) continue;
    survivors.push({ candidate, positionScore, match: m });
  }

  if (survivors.length > 0) {
    survivors.sort((a, b) => b.positionScore - a.positionScore);
    const winner = survivors[0];
    return {
      name: winner.candidate,
      citationIndex: winner.match.index,
      citationText: winner.match.text,
      citationType: winner.match.type,
    };
  }

  // No qualifying citation-adjacent candidate found — fall back to the
  // original "first line containing ' v '" heuristic, still
  // boundary-cleaned and still subject to the same disqualification
  // check (a fallback must not be less careful than the primary path).
  // No citation anchor exists for this path, so it is always reported as
  // low confidence by the caller.
  const firstLine = head.split("\n").map((l) => l.trim()).find((l) => l.length > 3 && / v[s]?\.? /i.test(l));
  if (!firstLine) return undefined;
  const cleaned = cleanCaseNameCandidate(firstLine);
  if (!cleaned || scoreCaseNameCandidate(cleaned, 0).disqualified) return undefined;
  return { name: cleaned, citationIndex: null, citationText: null, citationType: null };
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

/**
 * Metadata confidence — deliberately SEPARATE from `src/lib/extraction-
 * quality.ts` (Task 4, Phase 3: "architecturally separate TEXT quality
 * assessment from METADATA confidence assessment"). A document's TEXT can
 * be perfectly clean, well-structured, 100%-readable prose and still
 * yield a case-name proposal that should NOT be trusted automatically —
 * text quality answers "is this readable text," metadata confidence
 * answers "is this SPECIFIC proposed value actually the document's own
 * header, not something else in the document." These are independent
 * questions and must never be conflated into one score.
 */
export type MetadataConfidence = "high" | "low" | "none";

/**
 * A case-name candidate anchored to a citation within this many
 * characters of the document start is treated as high confidence — real
 * judgment headers are essentially always at or very near the top of the
 * extracted text. Anything found further in (still structurally valid,
 * still not disqualified — see scoreCaseNameCandidate) is surfaced as a
 * proposal but deliberately NOT auto-populated, per Task 4's explicit
 * instruction: "When uncertain: FAIL SAFE -> NEEDS REVIEW... Do not
 * manufacture confidence."
 */
const HIGH_CONFIDENCE_CITATION_WINDOW = 600;

export interface CaseLawExtractionResult {
  fields: ProposedCaseLawFields;
  /** Confidence in `fields.case_name` specifically — case name is the field most prone to a "false success" (a plausible-LOOKING but wrong proposal), per Task 4. Citation/date fields are direct pattern matches (or, when available, the exact citation the case name itself was validated against) rather than a positional judgment call, so they are not gated the same way. */
  caseNameConfidence: MetadataConfidence;
}

/**
 * Best-effort, clearly-labeled-as-proposed extraction, WITH an explicit
 * confidence signal for the case-name proposal specifically (Phase 3).
 * Never invents a value it can't find — leaves fields undefined rather
 * than guessing.
 */
export function extractCaseLawMetadataWithConfidence(text: string): CaseLawExtractionResult {
  const head = text.slice(0, 2000);
  const result: ProposedCaseLawFields = {};
  let caseNameConfidence: MetadataConfidence = "none";

  const nameResult = extractCaseNameCandidate(head);
  if (nameResult) {
    result.case_name = nameResult.name;
    // Reuse the EXACT citation the name was validated against, rather
    // than independently re-matching the head — keeps the two fields
    // genuinely paired instead of each picking a possibly different
    // citation occurrence.
    if (nameResult.citationType === "reported" && nameResult.citationText) {
      result.reported_citation = nameResult.citationText;
    } else if (nameResult.citationType === "neutral" && nameResult.citationText) {
      result.neutral_citation = nameResult.citationText;
    }
    caseNameConfidence =
      nameResult.citationIndex !== null && nameResult.citationIndex <= HIGH_CONFIDENCE_CITATION_WINDOW ? "high" : "low";
  }

  // Fill in whichever citation TYPE the winning case-name anchor did not
  // already supply — a document can genuinely carry both a neutral and a
  // reported citation for the same case, and a document with no
  // confident case name at all should still surface whatever citation
  // pattern the text contains.
  if (!result.neutral_citation) {
    const neutral = head.match(NEUTRAL_CITATION_RE);
    if (neutral) result.neutral_citation = neutral[0];
  }
  if (!result.reported_citation) {
    const reported = head.match(REPORTED_CITATION_RE);
    if (reported) result.reported_citation = reported[0];
  }

  const decidedDate = extractDecidedDate(head);
  if (decidedDate) result.decided_date_guess = decidedDate;

  return { fields: result, caseNameConfidence };
}

/** Backward-compatible convenience wrapper — same extraction, without the confidence detail. Prefer `extractCaseLawMetadataWithConfidence` for any call site that auto-populates a form field, per Phase 3. */
export function extractCaseLawMetadata(text: string): ProposedCaseLawFields {
  return extractCaseLawMetadataWithConfidence(text).fields;
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
