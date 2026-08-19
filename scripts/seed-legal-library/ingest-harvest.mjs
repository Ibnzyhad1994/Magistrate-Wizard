/**
 * Ingest harvested official-law JSON into the local Legal Library as
 * Review Queue drafts. Never auto-publishes.
 *
 *   node scripts/seed-legal-library/ingest-harvest.mjs
 *
 * Reads numbered JSON in scripts/seed-legal-library/catalogs/ (see README)
 * and creates Review Queue drafts via the same admin RPCs as New Import.
 * Duplicate citations/codes are skipped. Nothing is published.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSeedItem, isCatalogFilename } from "./seed-heuristics.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CATALOGS = join(ROOT, "scripts/seed-legal-library/catalogs");
const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:55321";
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@magistrate-wizard.local";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "password123";

const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

function sha256Text(text) {
  return createHash("sha256").update(String(text ?? "").trim(), "utf8").digest("hex");
}

function envelope(text, method = "manual_paste") {
  const trimmed = String(text ?? "").trim();
  return {
    status: trimmed ? "extracted" : "pending",
    method: trimmed ? method : "none",
    text: trimmed,
    charCount: trimmed.length,
    qualityScore: trimmed ? 1 : null,
    characterQuality: trimmed ? "high" : null,
    structuralQuality: trimmed ? "medium" : null,
    warnings: trimmed
      ? ["Seeded from an official public source. Curator must still vet before publish."]
      : ["Catalog entry only — attach or paste the official text in Review Queue."],
    ocrUsed: false,
    requiresReview: true,
    pages: [],
    pageCount: 0,
    unreadableReason: null,
  };
}

function clientAs(token) {
  return createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function ensureSource(sb, userId, harvest) {
  const name = harvest.source?.name ?? "Unknown official source";
  const { data: existing } = await sb.from("legal_sources").select("id").eq("name", name).maybeSingle();
  if (existing?.id) return existing.id;
  const { data, error } = await sb
    .from("legal_sources")
    .insert({
      name,
      jurisdiction: harvest.source?.jurisdiction === "mixed" ? "Guyana" : harvest.source?.jurisdiction ?? "Guyana",
      base_url: harvest.source?.base_url ?? null,
      source_type: harvest.source?.source_type === "mixed" ? "mixed" : harvest.source?.source_type ?? "legislation",
      connector_type: harvest.source?.connector_type ?? "index_page",
      status: "approved",
      canonical_trusted: true,
      notes: "Seeded from official public indexes. Review Queue still required before publish.",
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

function matchCourt(courts, name) {
  if (!name) return null;
  const n = name.toLowerCase();
  return (
    courts.find((c) => c.canonical_name.toLowerCase() === n) ??
    courts.find((c) => n.includes(c.canonical_name.toLowerCase()) || c.canonical_name.toLowerCase().includes(n)) ??
    null
  );
}

function matchJurisdiction(jurisdictions, name) {
  if (!name) return null;
  const n = name.toLowerCase();
  return (
    jurisdictions.find((j) => j.name.toLowerCase() === n) ??
    jurisdictions.find((j) => n.includes(j.name.toLowerCase()) || j.name.toLowerCase().includes(n)) ??
    null
  );
}

const stats = { legislation: 0, case_law: 0, skipped: 0, errors: 0 };

const { data: session, error: authErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (authErr) throw authErr;
const sb = clientAs(session.session.access_token);
const userId = session.user.id;

const { data: courts } = await sb.from("legal_authority_courts").select("id, canonical_name, jurisdiction_id");
const { data: jurisdictions } = await sb.from("legal_jurisdictions").select("id, name");

const files = readdirSync(CATALOGS).filter((f) => isCatalogFilename(f));
if (files.length === 0) {
  console.log(
    "No seed catalogs in scripts/seed-legal-library/catalogs/. Harvest into raw/, then run prepare-catalogs.mjs.",
  );
  process.exit(1);
}

for (const file of files) {
  const harvest = JSON.parse(readFileSync(join(CATALOGS, file), "utf8"));
  const items = Array.isArray(harvest.items) ? harvest.items : [];
  console.log(`\n${file}: ${items.length} items`);
  let sourceId = null;
  try {
    sourceId = await ensureSource(sb, userId, harvest);
  } catch (err) {
    console.warn(`  source registry failed: ${err.message}`);
  }

  for (const item of items) {
    const kind = item.kind ?? harvest.source?.source_type;
    const title = String(item.title ?? "").trim();
    const verdict = evaluateSeedItem(item, harvest);
    if (!verdict.eligible) {
      stats.skipped += 1;
      continue;
    }
    const text = String(item.full_text ?? "").trim();
    const hash = text ? sha256Text(text) : item.source_url ? sha256Text(item.source_url) : null;
    const env = envelope(text, text ? "manual_paste" : "none");

    try {
      if (kind === "case_law") {
        const citation = String(item.citation ?? title).slice(0, 240);
        const { data: dup } = await sb.from("case_law").select("id").eq("citation", citation).maybeSingle();
        if (dup?.id) {
          stats.skipped += 1;
          continue;
        }
        const courtName = item.court ?? "High Court of Guyana";
        const court = matchCourt(courts ?? [], courtName);
        const jurName = item.jurisdiction ?? "Guyana";
        const jur = matchJurisdiction(jurisdictions ?? [], jurName);
        const { error } = await sb.rpc("create_case_law_import", {
          p_case_name: title,
          p_citation: citation,
          p_court: court?.canonical_name ?? courtName,
          p_jurisdiction: jur?.name ?? jurName,
          p_court_id: court?.id ?? null,
          p_jurisdiction_id: jur?.id ?? court?.jurisdiction_id ?? null,
          p_neutral_citation: citation,
          p_reported_citation: null,
          p_decided_date: item.decided_date || null,
          p_full_text: text || null,
          p_source_url: item.source_url ?? null,
          p_source_id: sourceId,
          p_original_filename: item.original_filename ?? null,
          p_document_hash: hash,
          p_batch_id: null,
          p_extracted_metadata: { _extraction: env, harvest_error: item.harvest_error ?? null },
          p_proposed_tags: [],
          p_duplicate_warning: null,
        });
        if (error) throw error;
        stats.case_law += 1;
      } else {
        const code = String(item.code ?? title).slice(0, 120);
        const { data: dup } = await sb.from("statutes").select("id").eq("code", code).maybeSingle();
        if (dup?.id) {
          stats.skipped += 1;
          continue;
        }
        const jur = matchJurisdiction(jurisdictions ?? [], item.jurisdiction ?? "Guyana");
        const { error } = await sb.rpc("create_legislation_import", {
          p_code: code,
          p_title: title,
          p_jurisdiction: jur?.name ?? "Guyana",
          p_jurisdiction_id: jur?.id ?? null,
          p_short_title: item.short_title ?? null,
          p_full_text: text || null,
          p_source_url: item.source_url ?? null,
          p_source_id: sourceId,
          p_original_filename: item.original_filename ?? null,
          p_document_hash: hash,
          p_batch_id: null,
          p_extracted_metadata: { _extraction: env, harvest_error: item.harvest_error ?? null },
          p_proposed_tags: [],
          p_duplicate_warning: null,
          p_provisions: [],
        });
        if (error) throw error;
        stats.legislation += 1;
      }
    } catch (err) {
      stats.errors += 1;
      console.warn(`  FAIL ${title.slice(0, 80)} — ${err.message}`);
    }
  }
}

console.log("\nIngest complete (drafts only — nothing published).");
console.log(stats);
console.log("Open More → Legal Library → Review Queue to vet.");
