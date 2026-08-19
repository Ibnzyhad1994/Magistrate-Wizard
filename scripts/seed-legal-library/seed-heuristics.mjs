/**
 * Deterministic rules for whether a harvested item may become Legal Library
 * seed data. Ingest never auto-publishes; these rules only decide whether a
 * draft is worth creating.
 *
 * Legislation: Guyana official sources only.
 * Case law: official court/CCJ hosts with a real citation and a case name.
 */

export const LEGISLATION_HOSTS = new Set([
  "www.mola.gov.gy",
  "mola.gov.gy",
  "www.parliament.gov.gy",
  "parliament.gov.gy",
]);

export const CASE_LAW_HOSTS = new Set([
  "ccj.org",
  "www.ccj.org",
  "supremecourt.gy",
  "www.supremecourt.gy",
  "guyanacourts.gy",
  "www.guyanacourts.gy",
]);

/** Volume-level or association dumps — not a single official judgment URL. */
export const REJECTED_HOSTS = new Set([
  "guyanabarassociation.org",
  "www.guyanabarassociation.org",
]);

const BUDGET_ACT_RE =
  /appropriation|fiscal enactments|estimates of (the )?public sector|supplementary estimates/i;

const CASE_NAME_RE = /\bv(?:s)?\.?\b/i;
const REPORTED_CITATION_RE = /\(\d{4}\)\s?\d+\s?[A-Z][A-Za-z.]*\s?\d+/;
const NEUTRAL_CITATION_RE =
  /\[\d{4}\]\s?[A-Z]{1,4}(?:\.[A-Z]{1,4})*\.?\s?\d+|\b(?:19|20)\d{2}\s+(?=[A-Za-z]{0,9}[A-Z][A-Za-z]{0,8}[A-Z])[A-Za-z]{2,10}\s+\d{1,5}\b/;
const CHAPTER_CODE_RE = /\bCap\.?\s*\d+:\d+\b|\bChapter\s+\d+:\d+\b/i;
const ACT_NUMBER_RE = /\b\d{1,4}\s+(?:of|0f)\s+(?:19|20)\d{2}\b/i;
const ACT_NO_FILE_RE = /act_no\.?_?(\d+)_of_((?:19|20)\d{2})/i;

const JUNK_TEXT_RE =
  /access denied|just a moment|enable javascript|cloudflare|cookie (consent|policy)|page not found/i;

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function looksLikeProseFragment(title) {
  const t = String(title ?? "").trim();
  if (!t) return true;
  if (/^[a-z]/.test(t)) return true;
  if (t.length > 220 && !CASE_NAME_RE.test(t)) return true;
  return false;
}

function hasCitation(value) {
  const s = String(value ?? "");
  return REPORTED_CITATION_RE.test(s) || NEUTRAL_CITATION_RE.test(s);
}

/**
 * @returns {{ eligible: boolean, reasons: string[] }}
 */
export function evaluateSeedItem(item, harvest = {}) {
  const reasons = [];
  const kind = item?.kind ?? harvest?.source?.source_type;
  const title = String(item?.title ?? "").trim();
  const sourceUrl = String(item?.source_url ?? item?.pdf_url ?? "").trim();
  const host = hostOf(sourceUrl);
  const text = String(item?.full_text ?? "").trim();
  const jurisdiction = String(item?.jurisdiction ?? harvest?.source?.jurisdiction ?? "").trim();

  if (!title) reasons.push("missing title");
  if (!sourceUrl) reasons.push("missing official source_url");
  if (host && REJECTED_HOSTS.has(host)) {
    reasons.push(`host ${host} is not an official primary source (volume dump / association archive)`);
  }
  if (text && JUNK_TEXT_RE.test(text.slice(0, 800))) {
    reasons.push("full_text looks like a blocked or chrome page, not the instrument");
  }

  if (kind === "legislation") {
    if (jurisdiction && jurisdiction.toLowerCase() !== "guyana") {
      reasons.push("legislation must be Guyana-only");
    }
    if (host && !LEGISLATION_HOSTS.has(host)) {
      reasons.push(`legislation host ${host} is not MoLA or Parliament`);
    }
    if (BUDGET_ACT_RE.test(title) || BUDGET_ACT_RE.test(String(item?.code ?? ""))) {
      reasons.push("budget / estimates Act — not library seed material");
    }
    const identityBlob = [title, item?.code, item?.pdf_url, item?.original_filename, sourceUrl].join(" ");
    const hasChapter = CHAPTER_CODE_RE.test(identityBlob);
    const hasActNumber = ACT_NUMBER_RE.test(identityBlob) || ACT_NO_FILE_RE.test(identityBlob);
    const namedActOnOfficialHost = /\bActs?\b/i.test(title) && LEGISLATION_HOSTS.has(host);
    if (!hasChapter && !hasActNumber && !namedActOnOfficialHost) {
      reasons.push("no Chapter (Cap. N:N), Act number (N of YYYY), or official Act title");
    }
  } else if (kind === "case_law") {
    if (host && !CASE_LAW_HOSTS.has(host) && !REJECTED_HOSTS.has(host)) {
      reasons.push(`case law host ${host} is not an official court/CCJ site`);
    }
    if (!hasCitation(item?.citation) && !hasCitation(title)) {
      reasons.push("no reported or neutral citation");
    }
    if (!CASE_NAME_RE.test(title) || looksLikeProseFragment(title)) {
      reasons.push("title is not a Party v Party case name");
    }
  } else {
    reasons.push(`unknown kind ${kind ?? "(none)"}`);
  }

  return { eligible: reasons.length === 0, reasons };
}

export function isEligibleSeedItem(item, harvest) {
  return evaluateSeedItem(item, harvest).eligible;
}

/** Numbered harvest files only — skip _scratch / _inspect JSON. */
export function isCatalogFilename(name) {
  return /^\d{2}-[a-z0-9-]+\.json$/i.test(name);
}
