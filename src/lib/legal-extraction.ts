import { supabase } from "@/lib/supabase";
import {
  AMBIGUOUS_BARE_HIT_FLOOR,
  LEGAL_TAXONOMY_PHRASE_INDEX,
  SHORT_TAXONOMY_TOPICS,
} from "@/lib/legal-taxonomy";

/**
 * Deterministic (non-AI) extraction helpers for the Legal Library
 * ingestion pipeline. Everything here is plain JS text processing —
 * regex/heuristics/hashing — never a network call, never an LLM. This is
 * intentional: "do not use AI for tasks that deterministic processing can
 * reliably perform" (hashing, citation-pattern detection, section-number
 * parsing, date normalization, whitespace cleanup, keyword tagging).
 *
 * IMPORTANT HONESTY NOTE: document text for a PDF comes from
 * `runPdfExtractionPipeline` (text layer first, then local Tesseract OCR
 * for scans). `.txt`, Markdown, and `.docx` are read automatically.
 * Curator paste remains available when extraction cannot produce usable
 * text. Everything DOWNSTREAM of having that text — hashing, structuring,
 * classification, duplicate detection — is fully automatic.
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

/** Reads a text-like File as UTF-8. Uses the Blob `text()` API so the same path works in the browser and in Node tests. */
export function readFileAsText(file: File): Promise<string> {
  return file.text();
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
  case_name?: string
  neutral_citation?: string
  reported_citation?: string
  decided_date_guess?: string
}

/**
 * OCR text can look like clean prose and still misread a header citation.
 * High metadata confidence is only trusted for auto-fill when the text
 * came from a real PDF text layer (or curator paste), never from OCR.
 */
export const shouldAutoFillCaseName = (
  confidence: "high" | "low" | "none" | null | undefined,
  ocrUsed: boolean,
): boolean => confidence === "high" && !ocrUsed

/**
 * Drafts may carry a low-confidence running title (WIR heads, filename
 * pairing). Still never from OCR, and never treated as silent publish.
 */
export const shouldProposeCaseName = (
  confidence: "high" | "low" | "none" | null | undefined,
  ocrUsed: boolean,
): boolean => (confidence === "high" || confidence === "low") && !ocrUsed

/**
 * Medium-neutral citation, e.g. "[1969] SCR 525", "[2015] UKSC 20", or
 * "[1969] S.C.R. 525" — the reporter/court abbreviation may be written as
 * one unbroken token or with a period after each letter/group, both of
 * which are common, jurisdiction-generic conventions rather than specific
 * to any one reporter series (Phase F/S: generalize, don't hard-code a
 * single format observed in one test file).
 *
 * A second alternative (no brackets around the year at all) covers the
 * other standard medium-neutral-citation layout used across Commonwealth
 * practice — CanLII ("1987 CanLII 16"), Canadian appellate courts ("2011
 * NSCA 42"), the Caribbean Court of Justice ("2020 CCJ 1"), and the UK/NI/
 * Ireland neutral citation scheme ("2015 UKSC 20") all print "YYYY ABBREV
 * NUM" with no enclosing brackets or parentheses. The abbreviation token is
 * required to contain at least two uppercase letters (not merely start
 * with one) specifically so this alternative does not fire on ordinary
 * capitalized prose immediately following a bare year ("In 1987 Something
 * happened...") — every real court/reporter abbreviation observed across
 * Commonwealth Caribbean and wider common-law practice satisfies this,
 * while an ordinary capitalized English word essentially never does.
 *
 * SECURITY (Phase O): the "at least two uppercase letters" check is written
 * with explicitly BOUNDED quantifiers (`{0,9}`/`{0,8}`, matching the token's
 * own `{2,10}` length cap) rather than unbounded `*` stars specifically to
 * avoid the classic nested-quantifier catastrophic-backtracking shape
 * (`[A-Za-z]*[A-Z][A-Za-z]*[A-Z]`) that could otherwise cost O(length^2)
 * work on an adversarial run of thousands of letters with no second
 * uppercase. Every call site already bounds its input to a small "head"
 * window (~2000 characters, see buildHeadWindow) before this regex ever
 * runs, so this was not independently exploitable — bounding the
 * quantifiers here as well is defense-in-depth, not a response to a
 * reachable DoS.
 */
const NEUTRAL_CITATION_RE =
  /\[(\d{4})\]\s?[A-Z]{1,4}(?:\.[A-Z]{1,4})*\.?\s?\d+|\b(?:19|20)\d{2}\s+(?=[A-Za-z]{0,9}[A-Z][A-Za-z]{0,8}[A-Z])[A-Za-z]{2,10}\s+\d{1,5}\b/;
const REPORTED_CITATION_RE = /\(\d{4}\)\s?\d+\s?[A-Z][A-Za-z.]*\s?\d+/;
const DATE_RE =
  /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i;

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

const COURT_RUNNING_HEADING_RE =
  /\b(FULL COURT(?: OF THE HIGH COURT(?: OF [A-Z. ]+)?)?|COURT OF APPEAL(?: OF THE EASTERN CARIBBEAN STATES| OF [A-Z. ]+)?|CARIBBEAN COURT OF JUSTICE)\b/i;

/**
 * WIR two-column reports print letter rails (`a b c d e f g h j`) and
 * split ordinals (`25 th MAY`) in the extracted head. Clean only the
 * metadata window — stored full text is left as extracted.
 */
export function normalizeMetadataHead(head: string): string {
  return head
    .replace(/\b(\d{1,2})\s+(st|nd|rd|th)\b/gi, "$1$2")
    .replace(/\b(?:[a-j](?:\s+|$)){3,}/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeCitationKey(citation: string): string {
  return citation.replace(/\s+/g, " ").trim().toUpperCase();
}

export function citationReporterSeries(citation: string): string | null {
  const reported = citation.match(/\(\d{4}\)\s?\d+\s?([A-Z][A-Za-z.]*)\s?\d+/i);
  if (reported?.[1]) return reported[1].replace(/\./g, "").toUpperCase();
  const neutral = citation.match(/\[(\d{4})\]\s?(?:\d+\s+)?([A-Z][A-Za-z.]*)/i);
  if (neutral?.[2]) return neutral[2].replace(/\./g, "").toUpperCase();
  return null;
}

function citationsMatchIdentity(candidate: string, identity: string): boolean {
  if (normalizeCitationKey(candidate) === normalizeCitationKey(identity)) return true;
  const a = citationReporterSeries(candidate);
  const b = citationReporterSeries(identity);
  return !!a && !!b && a === b;
}

export interface RecordCitationResolution {
  reported?: string;
  neutral?: string;
  source: "filename" | "document" | "none";
  authoritiesCited: string[];
}

/**
 * Record identity is THIS report's citation, not the first authority
 * cited in a WIR headnote.
 */
export function resolveRecordCitation(opts: {
  filename?: string | null;
  reportedFromText?: string;
  neutralFromText?: string;
  head?: string;
}): RecordCitationResolution {
  const fromFilename = opts.filename ? extractCaseNameFromFilename(opts.filename) : undefined;
  const authorities: string[] = [];
  const pushAuthority = (value?: string) => {
    if (!value) return;
    if (!authorities.some((a) => normalizeCitationKey(a) === normalizeCitationKey(value))) {
      authorities.push(value);
    }
  };

  if (fromFilename?.reported_citation) {
    if (opts.reportedFromText && !citationsMatchIdentity(opts.reportedFromText, fromFilename.reported_citation)) {
      pushAuthority(opts.reportedFromText);
    }
    if (opts.neutralFromText && !citationsMatchIdentity(opts.neutralFromText, fromFilename.reported_citation)) {
      pushAuthority(opts.neutralFromText);
    }
    return {
      reported: fromFilename.reported_citation,
      neutral: fromFilename.neutral_citation,
      source: "filename",
      authoritiesCited: authorities,
    };
  }
  if (fromFilename?.neutral_citation) {
    if (opts.reportedFromText && !citationsMatchIdentity(opts.reportedFromText, fromFilename.neutral_citation)) {
      pushAuthority(opts.reportedFromText);
    }
    if (opts.neutralFromText && !citationsMatchIdentity(opts.neutralFromText, fromFilename.neutral_citation)) {
      pushAuthority(opts.neutralFromText);
    }
    return {
      reported: fromFilename.reported_citation,
      neutral: fromFilename.neutral_citation,
      source: "filename",
      authoritiesCited: authorities,
    };
  }

  if (opts.head) {
    const headerSeries = opts.head.match(/\(\d{4}\)\s?\d+\s?[A-Z][A-Za-z.]*(?:\s?\d+)?/);
    if (headerSeries && opts.reportedFromText && citationsMatchIdentity(opts.reportedFromText, headerSeries[0])) {
      return {
        reported: opts.reportedFromText,
        neutral: opts.neutralFromText,
        source: "document",
        authoritiesCited: [],
      };
    }
  }

  if (opts.reportedFromText || opts.neutralFromText) {
    return {
      reported: opts.reportedFromText,
      neutral: opts.neutralFromText,
      source: "document",
      authoritiesCited: [],
    };
  }
  return { source: "none", authoritiesCited: [] };
}

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

  // Trim whitespace FIRST, then strip trailing punctuation, then trim
  // again — a window ending "...State - " (dash followed by trailing
  // whitespace, common when a filename/header separator like " - " gets
  // caught at the very end of a candidate) previously left the dash
  // behind because the punctuation-strip regex anchors on the true end
  // of the string and a trailing space defeated it.
  candidate = candidate.replace(/\s{2,}/g, " ").trim().replace(/[|:\-–—]+$/, "").trim();
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

function extractCaseNameCandidate(
  head: string,
  preferredCitation?: string,
): CaseNameCandidateResult | undefined {
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

  const survivors: { candidate: string; positionScore: number; match: (typeof matches)[number]; identityBonus: number }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const prevEnd = i > 0 ? matches[i - 1].end : 0;
    const windowStart = Math.max(prevEnd, m.index - 200);
    const candidate = cleanCaseNameCandidate(head.slice(windowStart, m.index));
    if (!candidate) continue;
    const { disqualified, positionScore } = scoreCaseNameCandidate(candidate, m.index);
    if (disqualified) continue;
    const identityBonus =
      preferredCitation && citationsMatchIdentity(m.text, preferredCitation) ? 1000 : 0;
    survivors.push({ candidate, positionScore, match: m, identityBonus });
  }

  if (survivors.length > 0) {
    survivors.sort((a, b) => b.identityBonus - a.identityBonus || b.positionScore - a.positionScore);
    const winner = survivors[0];
    return {
      name: winner.candidate,
      citationIndex: winner.match.index,
      citationText: winner.match.text,
      citationType: winner.match.type,
    };
  }

  const runningTitle = extractRunningTitleBeforeCourt(head);
  if (runningTitle) {
    const identityMatch = preferredCitation
      ? matches.find((m) => citationsMatchIdentity(m.text, preferredCitation))
      : undefined;
    return {
      name: runningTitle,
      citationIndex: identityMatch?.index ?? null,
      citationText: identityMatch?.text ?? null,
      citationType: identityMatch?.type ?? null,
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

function extractRunningTitleBeforeCourt(head: string): string | undefined {
  const m = COURT_RUNNING_HEADING_RE.exec(head);
  if (!m || m.index < 8) return undefined;
  const before = head.slice(0, m.index);
  const vMatches = [...before.matchAll(/\b([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,8}\s+v(?:s)?\.?\s+[A-Z][\w.'-]*(?:\s+[A-Z&][\w.'-]*){0,10})\b/g)];
  const last = vMatches[vMatches.length - 1];
  if (!last?.[1]) return undefined;
  const cleaned = cleanCaseNameCandidate(last[1]);
  if (!cleaned || scoreCaseNameCandidate(cleaned, 0).disqualified) return undefined;
  return cleaned;
}

export interface FilenameProposal {
  case_name?: string;
  neutral_citation?: string;
  reported_citation?: string;
}

/**
 * SECONDARY-support-only filename parsing (PRODUCTION DOCUMENT INGESTION
 * PHASE, Section 16): many source files have informative names — "Diaz_
 * (Anthony)_v_The_State_-_(1989)_42_WIR_4.pdf", "The State v Dhannie
 * Ramsingh (1973) 20 WIR 138.pdf" — that can help propose a case name/
 * citation when document text is unavailable or not confident (e.g.
 * `requires_ocr`). Deliberately reuses the SAME citation-adjacent
 * scoring logic as document-text extraction (extractCaseNameCandidate)
 * rather than a separate parser — a filename is just a very short "head"
 * window once underscores/hyphens are normalized to spaces. NEVER
 * authoritative: the caller (use-bulk-import.ts) must only use this to
 * fill a gap, never to override a value already found in document text,
 * and must record the result's provenance as "filename", not
 * "document_text", wherever that distinction is surfaced to the curator.
 */
export function extractCaseNameFromFilename(filename: string): FilenameProposal | undefined {
  const withoutExtension = filename.replace(/\.[a-zA-Z0-9]{1,5}$/, "");
  const cleaned = withoutExtension
    .replace(/[_]+/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!cleaned) return undefined;

  const candidate = extractCaseNameCandidate(cleaned);
  if (candidate) {
    const result: FilenameProposal = { case_name: candidate.name };
    if (candidate.citationType === "reported" && candidate.citationText) result.reported_citation = candidate.citationText;
    else if (candidate.citationType === "neutral" && candidate.citationText) result.neutral_citation = candidate.citationText;
    return result;
  }

  // No " v "-shaped party string in the filename (Phase G: many real
  // archives name files after the citation alone, e.g. "1969 SCR 525.pdf"
  // or "2011 NSCA 42.pdf", with no party names at all) — independently
  // check for a bare citation pattern before giving up entirely. This is
  // deliberately generic (reuses the exact same citation regexes as
  // document-text extraction, not a filename-specific parser) and still
  // only ever a low-confidence, clearly-secondary proposal, same as the
  // case-name path above. A filename with the year/abbreviation/number run
  // together with no separator at all (e.g. "1987canlii16.pdf") is NOT
  // parsed here — doing so would require a hard-coded dictionary of known
  // reporter abbreviations to find the split points, which is exactly the
  // kind of fixture-specific hack this pass must not introduce; those
  // cases are left for document-text extraction or manual review instead.
  const reported = cleaned.match(REPORTED_CITATION_RE);
  const neutral = cleaned.match(NEUTRAL_CITATION_RE);
  if (reported) return { reported_citation: reported[0] };
  if (neutral) return { neutral_citation: neutral[0] };
  return undefined;
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

export interface CaseLawExtractionOptions {
  filename?: string | null;
}

export interface CaseLawExtractionResult {
  fields: ProposedCaseLawFields;
  /** Confidence in `fields.case_name` specifically — case name is the field most prone to a "false success" (a plausible-LOOKING but wrong proposal), per Task 4. Citation/date fields are direct pattern matches (or, when available, the exact citation the case name itself was validated against) rather than a positional judgment call, so they are not gated the same way. */
  caseNameConfidence: MetadataConfidence;
  /** Citations in the head that are not this report's identity. */
  authoritiesCited: string[];
  citationSource: "filename" | "document" | "none";
}

/** Minimal shape needed from an ExtractionEnvelope's page breakdown — declared locally rather than importing extraction-pipeline.ts's type, so this module has no dependency in that direction. */
export interface PageLike {
  pageNumber: number;
  text: string;
}

/**
 * Builds the metadata-extraction "head" window from a page-aware
 * breakdown when one is available (PRODUCTION DOCUMENT INGESTION PHASE,
 * Section 34: "metadata extraction prioritizes early pages... body
 * citations on later pages do not outrank document-header metadata").
 * Prefers page 1 alone — real judgment headers are on the first page —
 * only pulling in subsequent pages if page 1 is too short to plausibly
 * contain a header (a short/blank cover page happens occasionally).
 * Falls back to the old flat-character-slice behavior when no page
 * breakdown is available (e.g. .txt/manual-paste text, or a PDF where
 * page attribution wasn't possible), so this is a strict enhancement,
 * never a regression for text without page information.
 */
function buildHeadWindow(text: string, pages?: PageLike[]): string {
  if (!pages || pages.length === 0) return text.slice(0, 2000);
  let combined = pages[0]?.text ?? "";
  let i = 1;
  while (combined.length < 400 && i < pages.length) {
    combined += "\n\n" + pages[i].text;
    i += 1;
  }
  return combined.slice(0, 2000);
}

/**
 * Best-effort, clearly-labeled-as-proposed extraction, WITH an explicit
 * confidence signal for the case-name proposal specifically (Phase 3).
 * Never invents a value it can't find — leaves fields undefined rather
 * than guessing. `pages`, when supplied, is used to prioritize early
 * pages for header signals (see buildHeadWindow above) — optional and
 * backward compatible.
 */
export function extractCaseLawMetadataWithConfidence(
  text: string,
  pages?: PageLike[],
  options?: CaseLawExtractionOptions,
): CaseLawExtractionResult {
  const head = normalizeMetadataHead(buildHeadWindow(text, pages));
  const result: ProposedCaseLawFields = {};
  let caseNameConfidence: MetadataConfidence = "none";
  const filenameProposal = options?.filename ? extractCaseNameFromFilename(options.filename) : undefined;
  const preferredCitation = filenameProposal?.reported_citation ?? filenameProposal?.neutral_citation;

  const nameResult = extractCaseNameCandidate(head, preferredCitation);
  if (nameResult) {
    result.case_name = nameResult.name;
    if (nameResult.citationType === "reported" && nameResult.citationText) {
      result.reported_citation = nameResult.citationText;
    } else if (nameResult.citationType === "neutral" && nameResult.citationText) {
      result.neutral_citation = nameResult.citationText;
    }
    const pairedWithIdentity =
      !!preferredCitation &&
      !!nameResult.citationText &&
      citationsMatchIdentity(nameResult.citationText, preferredCitation);
    caseNameConfidence =
      nameResult.citationIndex !== null &&
      nameResult.citationIndex <= HIGH_CONFIDENCE_CITATION_WINDOW &&
      (!preferredCitation || pairedWithIdentity)
        ? "high"
        : "low";
  }

  if (!result.neutral_citation) {
    const neutral = head.match(NEUTRAL_CITATION_RE);
    if (neutral) result.neutral_citation = neutral[0];
  }
  if (!result.reported_citation) {
    const reported = head.match(REPORTED_CITATION_RE);
    if (reported) result.reported_citation = reported[0];
  }

  const identity = resolveRecordCitation({
    filename: options?.filename,
    reportedFromText: result.reported_citation,
    neutralFromText: result.neutral_citation,
    head,
  });
  if (identity.reported) result.reported_citation = identity.reported;
  if (identity.neutral) result.neutral_citation = identity.neutral;
  if (
    result.neutral_citation &&
    identity.authoritiesCited.some((a) => citationsMatchIdentity(a, result.neutral_citation as string))
  ) {
    result.neutral_citation = undefined;
  }

  const decidedDate = extractDecidedDate(head);
  if (decidedDate) result.decided_date_guess = decidedDate;

  return {
    fields: result,
    caseNameConfidence,
    authoritiesCited: identity.authoritiesCited,
    citationSource: identity.source,
  };
}

/** Backward-compatible convenience wrapper — same extraction, without the confidence detail. Prefer `extractCaseLawMetadataWithConfidence` for any call site that auto-populates a form field, per Phase 3. */
export function extractCaseLawMetadata(text: string): ProposedCaseLawFields {
  return extractCaseLawMetadataWithConfidence(text).fields;
}

// ---------------------------------------------------------------------------
// Legislation title/metadata extraction. Unlike Case Law, the real "New
// Import" UI has always required a human to type the Legislation title by
// hand — there was previously no extraction heuristic for it at all. This
// exists primarily so the bulk seed-catalog ingest path (which has no human
// in the loop at creation time) can recover a real title when the harvested
// metadata is missing or suspect, without ever silently overwriting a good
// harvested value — see ingest-harvest.mjs's title-preference rule.
// ---------------------------------------------------------------------------

const LEGISLATION_HEAD_WINDOW = 1500;
/** A title-bearing header found this close to the document start is high
 * confidence — the same "real headers are near the top" reasoning as
 * HIGH_CONFIDENCE_CITATION_WINDOW above, just legislation's own threshold
 * since gazette front matter tends to run a little longer than a judgment
 * header before the Act title appears. */
const LEGISLATION_HIGH_CONFIDENCE_WINDOW = 800;

/** Lines that are gazette/report running header furniture, never the Act's
 * own title, even though they're ALL CAPS and appear near the document
 * start — must be excluded from the header-line heuristic below. */
const LEGISLATION_HEADER_EXCLUDE_RE = /official gazette|legal supplement|laws\s+of\s+guyana/i;

/** Fixed statutory drafting formula ("This Act may be cited as the ...
 * Act") — the single most reliable title signal in a Commonwealth Act,
 * since it's a self-citation sentence, not a page-layout guess.
 * Non-greedy up to the FIRST "Act"/"Ordinance"/"Regulations", with an
 * optional trailing year captured separately — real drafting sometimes
 * runs the short-title and commencement clauses together in one sentence
 * ("...may be cited as the X Act 1985 and shall come into operation..."),
 * and a greedy match-to-next-period would swallow the commencement text
 * too. */
const CITED_AS_RE = /\bmay be cited as the\s+([^.\n]{3,120}?\b(?:Act|Ordinance|Regulations))\b(?:,?\s*((?:19|20)\d{2}))?/i;

/** A whole line that is essentially all caps/punctuation (a real title
 * line), tested per-line against RAW (non-whitespace-normalized) text —
 * normalizeMetadataHead's blank-line collapsing would otherwise merge a
 * gazette running-header line with the very next line (the Act's actual
 * title), making a single combined-line regex unreliable. Dash variants
 * included since real gazette text uses an em dash ("LEGAL SUPPLEMENT —
 * A"). */
const ALL_CAPS_LINE_RE = /^[A-Z0-9 ,.'()\-–—]{8,150}$/;
const LEGISLATION_KEYWORD_RE = /\b(?:ACT|ORDINANCE|REGULATIONS)\b/i;

/** Reused shape from scripts/seed-legal-library/seed-heuristics.mjs's
 * ACT_NUMBER_RE — kept in sync deliberately (both match "N of YYYY", with
 * the common OCR/typo confusion of "of" as "0f"). */
const ACT_NUMBER_RE = /\b(\d{1,4})\s+(?:of|0f)\s+((?:19|20)\d{2})\b/i;
const CHAPTER_CODE_RE = /\bCap\.?\s*\d+:\d+\b/i;

export interface ProposedLegislationFields {
  title?: string;
  short_title?: string;
  act_number?: string;
  enactment_year?: number;
  instrument_type?: string;
  chapter_number?: string;
}

export interface LegislationExtractionResult {
  fields: ProposedLegislationFields;
  /** Confidence in `fields.title`/`fields.short_title` specifically — the
   * field most prone to a wrong-but-plausible proposal, same reasoning as
   * `caseNameConfidence` above. */
  titleConfidence: MetadataConfidence;
  actNumberConfidence: MetadataConfidence;
}

/**
 * Best-effort, clearly-labeled-as-proposed Legislation title/metadata
 * extraction, with an explicit confidence signal. Never invents a value it
 * can't find — leaves fields undefined rather than guessing.
 * `effective_date` is deliberately NOT extracted here: Guyana commencement
 * clauses vary too much ("on the date of publication," "on a date fixed by
 * order of the Minister," explicit/retroactive dates) for a generic regex
 * to be trustworthy, and a wrong auto-filled effective date is a legally
 * significant error in a way a wrong act number is not — leave it
 * curator-entered only.
 */
export function extractLegislationMetadataWithConfidence(text: string): LegislationExtractionResult {
  const rawHeadSlice = text.slice(0, LEGISLATION_HEAD_WINDOW);
  // Used for CITED_AS_RE / ACT_NUMBER_RE / CHAPTER_CODE_RE, which benefit
  // from whitespace normalization (a citation clause can hard-wrap across
  // lines in source text). NOT used for the header-line search below —
  // see ALL_CAPS_LINE_RE's comment for why that needs the raw lines.
  const head = normalizeMetadataHead(rawHeadSlice);
  const fields: ProposedLegislationFields = {};
  let titleConfidence: MetadataConfidence = "none";
  let actNumberConfidence: MetadataConfidence = "none";

  const citedAs = text.match(CITED_AS_RE);
  if (citedAs) {
    const title = citedAs[2] ? `${citedAs[1].trim()} ${citedAs[2]}` : citedAs[1].trim();
    fields.title = title;
    fields.short_title = title;
    titleConfidence = "high";
  } else {
    // A scanned gazette title commonly wraps across two consecutive lines
    // ("MOTOR VEHICLES AND ROAD TRAFFIC" / "(AMENDMENT) ACT 1998") --
    // check each line's own char range for the keyword first, but if not
    // found, try merging it with up to 2 following all-caps lines before
    // giving up on that starting line, so a wrapped title is still
    // recovered as one candidate rather than only its second half.
    const rawLines = rawHeadSlice.split(/\r?\n/).map((l) => l.trim());
    let charIndex = 0;
    const lineStarts = rawLines.map((l) => {
      const start = charIndex;
      charIndex += l.length + 1;
      return start;
    });
    outer: for (let i = 0; i < rawLines.length; i++) {
      if (rawLines[i].length === 0 || !ALL_CAPS_LINE_RE.test(rawLines[i])) continue;
      let candidate = rawLines[i];
      for (let span = 0; span < 3 && i + span < rawLines.length; span++) {
        if (span > 0) {
          const next = rawLines[i + span];
          if (next.length === 0 || !ALL_CAPS_LINE_RE.test(next)) break;
          candidate = `${candidate} ${next}`;
        }
        if (LEGISLATION_KEYWORD_RE.test(candidate) && !LEGISLATION_HEADER_EXCLUDE_RE.test(candidate)) {
          fields.title = candidate;
          titleConfidence = lineStarts[i] <= LEGISLATION_HIGH_CONFIDENCE_WINDOW ? "high" : "low";
          break outer;
        }
      }
    }
  }

  const actNumberMatch = head.match(ACT_NUMBER_RE);
  if (actNumberMatch) {
    fields.act_number = `${actNumberMatch[1]} of ${actNumberMatch[2]}`;
    fields.enactment_year = Number(actNumberMatch[2]);
    actNumberConfidence = /act\s*no\.?\s*$/i.test(head.slice(0, actNumberMatch.index ?? 0)) ? "high" : "low";
  }

  if (fields.title) {
    if (/\bORDINANCE\b/i.test(fields.title)) fields.instrument_type = "Ordinance";
    else if (/\bREGULATIONS\b/i.test(fields.title)) fields.instrument_type = "Regulations";
    else if (/\bACT\b/i.test(fields.title)) fields.instrument_type = "Act";
  }

  const chapterMatch = head.match(CHAPTER_CODE_RE);
  if (chapterMatch) fields.chapter_number = chapterMatch[0];

  return { fields, titleConfidence, actNumberConfidence };
}

/** Backward-compatible convenience wrapper, mirroring `extractCaseLawMetadata`. */
export function extractLegislationMetadata(text: string): ProposedLegislationFields {
  return extractLegislationMetadataWithConfidence(text).fields;
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
// Canonical tag proposal (scored keyword / alias match against the curated
// taxonomy — src/lib/legal-taxonomy.ts). NOT AI. Word-boundary matching,
// negation lookbehind, legal-section boosts, short-token floor, specificity
// demotion. Presented as proposed tags only.
// ---------------------------------------------------------------------------

/** Chars scanned for tag proposals — enough for judgments; caps megabyte pastes. */
const TAG_SCAN_CHARS = 80_000;
/** Matches in this prefix get a small header boost (same idea as court matching). */
const TAG_HEADER_WINDOW_CHARS = 3_000;
/** Cap how much repeated hits can inflate a topic's score. */
const TAG_OCCURRENCE_BONUS_CAP = 3;
/** Chars before a hit inspected for local negation cues. */
const TAG_NEGATION_LOOKBEHIND = 40;
/** Score boost when a hit falls inside a Held/Issues/Decision-style span. */
const TAG_SECTION_BOOST = 10;
/** Confidence tier cutoffs (deterministic; tuned against hard suite fixtures). */
export const TAG_CONFIDENCE_HIGH_MIN = 40;
export const TAG_CONFIDENCE_MEDIUM_MIN = 25;

export type TagConfidence = "high" | "medium" | "low";

export interface ProposedTagScore {
  name: string;
  score: number;
  hitCount: number;
  confidence: TagConfidence;
  /** True if any match came from an alias phrase rather than the topic label alone. */
  matchedViaAlias: boolean;
  /** True if any match fell in the header window. */
  inHeader: boolean;
  /** True if any non-negated hit fell in a Held/Issues/Decision-style span. */
  inLegalSection: boolean;
}

export interface TagProposalDetail {
  name: string;
  score: number;
  confidence: TagConfidence;
  hitCount: number;
}

export const tagConfidenceFromScore = (score: number): TagConfidence => {
  if (score >= TAG_CONFIDENCE_HIGH_MIN) return "high";
  if (score >= TAG_CONFIDENCE_MEDIUM_MIN) return "medium";
  return "low";
};

/** Local negation immediately before a matched phrase (not distant "not" in the sentence). */
const NEGATION_BEFORE_RE =
  /(?:^|[^a-z0-9])(?:not|no|without|rather\s+than|unlike|false)\s*$/i;

const isLocallyNegated = (hay: string, phraseStart: number): boolean => {
  const from = Math.max(0, phraseStart - TAG_NEGATION_LOOKBEHIND);
  const window = hay.slice(from, phraseStart);
  return NEGATION_BEFORE_RE.test(window);
};

const SECTION_HEADING_RE =
  /(?:^|\n)\s*(HELD|HOLDING|ISSUES?|GROUNDS?|RATIO|DECISION|ORDER|DISPOSITION)\b[^\n]{0,120}/gi;

interface OffsetSpan {
  start: number;
  end: number;
}

/** Coarse Held/Issues/Decision spans — heading to next heading or +2500 chars. */
export const buildLegalSectionSpans = (hay: string): OffsetSpan[] => {
  const headings: number[] = [];
  SECTION_HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SECTION_HEADING_RE.exec(hay)) !== null) {
    headings.push(m.index);
    if (m[0].length === 0) SECTION_HEADING_RE.lastIndex += 1;
  }
  if (headings.length === 0) return [];
  const spans: OffsetSpan[] = [];
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i];
    const next = headings[i + 1];
    const end = next != null ? next : Math.min(hay.length, start + 2500);
    spans.push({ start, end });
  }
  return spans;
};

const offsetInSpans = (offset: number, spans: OffsetSpan[]): boolean =>
  spans.some((s) => offset >= s.start && offset < s.end);

interface TopicAccumulator {
  score: number;
  hitCount: number;
  bareHitCount: number;
  matchedViaAlias: boolean;
  inHeader: boolean;
  inLegalSection: boolean;
  longestPhrase: string;
  multiWordHit: boolean;
}

/**
 * Scored tag proposals. Prefer this when diagnostics or ranking matter;
 * `proposeTags` wraps it for the ingest RPC (names only).
 */
export function proposeTagsScored(text: string, limit = 10): ProposedTagScore[] {
  if (!text?.trim()) return [];

  const hay = text.length > TAG_SCAN_CHARS ? text.slice(0, TAG_SCAN_CHARS) : text;
  const sectionSpans = buildLegalSectionSpans(hay);
  const byTopic = new Map<string, TopicAccumulator>();

  for (const entry of LEGAL_TAXONOMY_PHRASE_INDEX) {
    entry.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    let localHits = 0;
    let firstIndex = -1;
    let anyInSection = false;
    while ((match = entry.pattern.exec(hay)) !== null) {
      const phraseStart = match.index + (match[0].length - (match[1]?.length ?? 0));
      if (isLocallyNegated(hay, phraseStart)) {
        if (match[0].length === 0) entry.pattern.lastIndex += 1;
        continue;
      }
      localHits += 1;
      if (firstIndex < 0) firstIndex = phraseStart;
      if (offsetInSpans(phraseStart, sectionSpans)) anyInSection = true;
      if (match[0].length === 0) entry.pattern.lastIndex += 1;
    }
    if (localHits === 0) continue;

    const inHeader = firstIndex >= 0 && firstIndex < TAG_HEADER_WINDOW_CHARS;
    const isBareToken = entry.tokenCount === 1 && !entry.isAlias;
    let score = entry.phrase.length;
    if (entry.tokenCount > 1) score += 12;
    if (entry.isAlias && entry.tokenCount > 1) score += 6;
    if (entry.isAlias && entry.tokenCount === 1) score += 4;
    if (inHeader) score += 8;
    if (anyInSection) score += TAG_SECTION_BOOST;
    score += Math.min(localHits, TAG_OCCURRENCE_BONUS_CAP);

    const prev = byTopic.get(entry.topic);
    if (!prev) {
      byTopic.set(entry.topic, {
        score,
        hitCount: localHits,
        bareHitCount: isBareToken ? localHits : 0,
        matchedViaAlias: entry.isAlias,
        inHeader,
        inLegalSection: anyInSection,
        longestPhrase: entry.phrase,
        multiWordHit: entry.tokenCount > 1,
      });
    } else {
      prev.score = Math.max(prev.score, score) + Math.min(localHits, 2);
      prev.hitCount += localHits;
      if (isBareToken) prev.bareHitCount += localHits;
      prev.matchedViaAlias = prev.matchedViaAlias || entry.isAlias;
      prev.inHeader = prev.inHeader || inHeader;
      prev.inLegalSection = prev.inLegalSection || anyInSection;
      prev.multiWordHit = prev.multiWordHit || entry.tokenCount > 1;
      if (entry.phrase.length > prev.longestPhrase.length) {
        prev.longestPhrase = entry.phrase;
      }
    }
  }

  for (const [topic, acc] of [...byTopic.entries()]) {
    if (!SHORT_TAXONOMY_TOPICS.has(topic)) continue;
    const clearsFloor =
      acc.multiWordHit || acc.matchedViaAlias || acc.bareHitCount >= AMBIGUOUS_BARE_HIT_FLOOR;
    if (!clearsFloor) {
      byTopic.delete(topic);
    }
  }

  const ranked = [...byTopic.entries()]
    .map(([name, acc]) => ({ name, ...acc }))
    .sort((a, b) => b.score - a.score || b.hitCount - a.hitCount || a.name.localeCompare(b.name));

  const kept: typeof ranked = [];
  for (const candidate of ranked) {
    const suppressed = kept.some((stronger) => {
      if (stronger.name === candidate.name) return false;
      if (candidate.name.length >= stronger.name.length) return false;
      if (!SHORT_TAXONOMY_TOPICS.has(candidate.name)) return false;
      const strongerHay = `${stronger.name} ${stronger.longestPhrase}`.toLowerCase();
      const short = candidate.name.toLowerCase();
      const re = new RegExp(
        `(?:^|[^a-z0-9])${short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[^a-z0-9]|$)`,
        "i",
      );
      return re.test(strongerHay);
    });
    if (!suppressed) kept.push(candidate);
  }

  return kept.slice(0, limit).map(({ name, score, hitCount, matchedViaAlias, inHeader, inLegalSection }) => ({
    name,
    score,
    hitCount,
    confidence: tagConfidenceFromScore(score),
    matchedViaAlias,
    inHeader,
    inLegalSection,
  }));
}

export function proposeTags(text: string, limit = 10): string[] {
  return proposeTagsScored(text, limit).map((t) => t.name);
}

/** Shape stored under extracted_metadata.tag_proposals at ingest (no migration). */
export function toTagProposalDetails(scored: ProposedTagScore[]): TagProposalDetail[] {
  return scored.map(({ name, score, confidence, hitCount }) => ({
    name,
    score,
    confidence,
    hitCount,
  }));
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
