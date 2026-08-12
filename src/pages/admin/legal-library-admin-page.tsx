import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  FolderUp,
  Landmark,
  Plus,
  ScrollText,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { DateOnlyInput } from "@/components/common/date-only-input";
import { SaveIndicator, type SaveState } from "@/components/common/save-indicator";
import { toast } from "sonner";
import {
  useLegalSources,
  useCreateLegalSource,
  useDeleteLegalSource,
} from "@/hooks/legal-library/use-legal-sources";
import {
  useLegalJurisdictions,
  useLegalAuthorityCourts,
} from "@/hooks/legal-library/use-legal-taxonomy";
import {
  useIngestCaseLaw,
  useIngestLegislation,
} from "@/hooks/legal-library/use-import-jobs";
import { useBulkImportCaseLaw } from "@/hooks/legal-library/use-bulk-import";
import {
  summarizeBulkQueue,
  BULK_STATUS_LABEL,
  type BulkItemStatus,
} from "@/lib/bulk-ingestion-queue";
import {
  useCaseLawReviewQueue,
  useUpdateCanonicalCaseLaw,
  useSetCaseLawReviewStatus,
  useRejectCanonicalCaseLaw,
} from "@/hooks/case-law/use-case-law";
import { useCaseLawTags, useApplyCaseLawTags } from "@/hooks/case-law/use-case-law-tags";
import {
  useLegislationReviewQueue,
  useUpdateCanonicalStatute,
  useSetStatuteReviewStatus,
  useRejectCanonicalStatute,
  useStatuteProvisions,
} from "@/hooks/legislation/use-legislation";
import { useStatuteTags, useApplyStatuteTags } from "@/hooks/legislation/use-statute-tags";
import { getDocumentViewUrl } from "@/hooks/use-documents";
import { readFileAsText, extractCaseLawMetadataWithConfidence, normalizeWhitespace } from "@/lib/legal-extraction";
import { matchCanonicalCourtScored } from "@/lib/legal-taxonomy-match";
import {
  isPlaceholderValue,
  validateCaseLawForPublish,
  validateLegislationForPublish,
} from "@/lib/publication-validation";
import {
  runPdfExtractionPipeline,
  buildTextFileEnvelope,
  buildManualPasteEnvelope,
  emptyExtractionEnvelope,
  type ExtractionEnvelope,
} from "@/lib/extraction-pipeline";
import { ROUTES } from "@/routes/paths";
import { formatDate } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { CaseLaw, Statute } from "@/types/database.types";

/** Small labeled-field wrapper — every editable Review Queue / New Import field renders through this so no field is ever identifiable only by placeholder text (§5). */
function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

type ReviewRow<T> = T & {
  duplicate_warning: string | null;
  proposed_tags: string[];
  uploaded_document_id: string | null;
  job_status: string | null;
  /** import_jobs.extracted_metadata — deterministic proposal fields plus, under `_extraction`, the full ExtractionEnvelope (status/method/quality/warnings/ocrUsed). Machine-derived, always a proposal, never silently promoted to canonical (§Phase 7). */
  extracted_metadata: unknown;
  job_error_summary: string | null;
};

/** Pulls the ExtractionEnvelope this draft was created with out of `extracted_metadata._extraction`, if present — older drafts created before this pass have none, which is treated as "pending" rather than an error. */
function readExtractionEnvelope(extractedMetadata: unknown): ExtractionEnvelope | null {
  if (!extractedMetadata || typeof extractedMetadata !== "object") return null;
  const envelope = (extractedMetadata as Record<string, unknown>)._extraction;
  if (!envelope || typeof envelope !== "object") return null;
  return envelope as ExtractionEnvelope;
}

/** Pulls the case-name metadata confidence recorded at ingest time (Phase 3/8) out of `extracted_metadata._metadataConfidence.caseName`, if present — older drafts created before this pass have none. */
function readCaseNameConfidence(extractedMetadata: unknown): "high" | "low" | "none" | null {
  if (!extractedMetadata || typeof extractedMetadata !== "object") return null;
  const confidence = (extractedMetadata as Record<string, unknown>)._metadataConfidence;
  if (!confidence || typeof confidence !== "object") return null;
  const caseName = (confidence as Record<string, unknown>).caseName;
  return caseName === "high" || caseName === "low" || caseName === "none" ? caseName : null;
}

/** Pulls WHERE the case name actually came from (`_metadataConfidence.caseNameSource` — Section 16/17/35-J: filename-derived metadata must be recorded and shown as such, never presented as if it came from the document text). `null` = not recorded (older draft, no case name at all, or Legislation). */
function readCaseNameSource(extractedMetadata: unknown): "document" | "filename" | "curator" | null {
  if (!extractedMetadata || typeof extractedMetadata !== "object") return null;
  const confidence = (extractedMetadata as Record<string, unknown>)._metadataConfidence;
  if (!confidence || typeof confidence !== "object") return null;
  const source = (confidence as Record<string, unknown>).caseNameSource;
  return source === "document" || source === "filename" || source === "curator" ? source : null;
}

/**
 * A single, plain-language PRIMARY state — deliberately just this
 * vocabulary (PRODUCTION DOCUMENT INGESTION PHASE, Section 7) and never a
 * raw score. Distinguishes CHARACTER quality (folded into the underlying
 * "extracted"/"low_quality"/"failed" status, since garbled characters
 * were always a hard-fail condition upstream) from STRUCTURAL quality
 * (envelope.structuralQuality — genuinely readable text that still isn't
 * reliable reading order) from METADATA confidence (caseNameConfidence —
 * a separate question about whether the PROPOSED case name specifically
 * can be trusted). This is exactly the three-way split the real Ramsingh
 * "100% quality, wrong case name" false success violated.
 */
type IngestionUiTone = "good" | "warn" | "bad" | "neutral";

function deriveIngestionUiState(
  envelope: ExtractionEnvelope,
  caseNameConfidence: "high" | "low" | "none" | null,
): { label: string; tone: IngestionUiTone } {
  if (envelope.status === "pending") return { label: "No text yet", tone: "neutral" };
  if (envelope.status === "failed") return { label: "Extraction failed", tone: "bad" };
  if (envelope.status === "requires_ocr") return { label: "OCR required", tone: "warn" };
  // "extracted" or "low_quality" from here — genuinely usable text exists.
  if (envelope.status === "low_quality" || envelope.structuralQuality === "poor") {
    return { label: "Text extracted — formatting requires review", tone: "warn" };
  }
  if (caseNameConfidence === "low") return { label: "Metadata confidence low — review required", tone: "warn" };
  if (caseNameConfidence === "none") return { label: "Metadata partially identified", tone: "warn" };
  return { label: "Text extracted successfully", tone: "good" };
}

const TONE_BADGE_VARIANT: Record<IngestionUiTone, "canonical" | "destructive" | "outline" | "secondary"> = {
  good: "canonical",
  bad: "destructive",
  warn: "outline",
  neutral: "secondary",
};

/**
 * Compact, reusable extraction-provenance readout — Review Queue §Phase 9:
 * "What did the machine determine? What remains uncertain?" answered in
 * one glance, without cluttering the card.
 *
 * WORDING FIX (Task 4, then PRODUCTION DOCUMENT INGESTION PHASE Section 7):
 * this used to show a bare "Quality: N%" figure taken directly from the
 * character-level quality score — which is exactly how a document with
 * clean, readable, but WRONG text (the real Ramsingh false-success case)
 * could display "Quality: 100%" right next to an incorrect proposed case
 * name, misleadingly implying the whole extraction — including the
 * proposed metadata — was fully trustworthy. This panel now shows ONE
 * plain-language primary state (see deriveIngestionUiState) drawn from
 * three genuinely independent signals — character quality, structural
 * quality, and metadata confidence — never a percentage. Technical detail
 * (warnings, page count, raw method) lives behind a collapsed "Extraction
 * details" disclosure so the normal card stays uncluttered.
 */
function ExtractionStatusPanel({
  envelope,
  caseNameConfidence = null,
  caseNameSource = null,
}: {
  envelope: ExtractionEnvelope | null;
  /** Only meaningful for Case Law; omitted entirely for Legislation (no case-name concept). `null`/undefined = not recorded (older draft, or Legislation). */
  caseNameConfidence?: "high" | "low" | "none" | null;
  /** Where the case name displayed on this draft actually came from (Section 16/17/35-J). A filename-derived name is real, useful information — but must never be shown as if the document text itself confirmed it. */
  caseNameSource?: "document" | "filename" | "curator" | null;
}) {
  if (!envelope || envelope.status === "pending") {
    return (
      <p className="text-xs text-muted-foreground">
        No document text was extracted for this draft — Document text (if any) was entered manually.
      </p>
    );
  }
  const methodLabel: Record<ExtractionEnvelope["method"], string> = {
    pdf_text_layer: "PDF text layer",
    txt_file: "Plain text file",
    manual_paste: "Manually entered",
    ocr: "OCR",
    none: "—",
  };
  const state = deriveIngestionUiState(envelope, caseNameConfidence);
  const hasTechnicalDetail =
    envelope.warnings.length > 0 ||
    envelope.charCount > 0 ||
    envelope.pageCount > 0 ||
    (caseNameConfidence !== null && caseNameConfidence !== "high");

  return (
    <div className="space-y-1.5 rounded-md border border-border p-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={TONE_BADGE_VARIANT[state.tone]}>{state.label}</Badge>
        <span className="text-muted-foreground">Source: {methodLabel[envelope.method]}</span>
        {envelope.pageCount > 0 && (
          <span className="text-muted-foreground">
            {envelope.pageCount} page{envelope.pageCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {(envelope.status === "requires_ocr" || envelope.status === "failed") && (
        <p className="text-[11px] text-muted-foreground">
          This document requires OCR or manual text entry. The original file has been preserved, but reliable text
          could not be extracted automatically.
        </p>
      )}
      {caseNameSource === "filename" && (
        <p className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Case name proposed from the file name, not the document text — please verify against the original before
          publishing.
        </p>
      )}
      {hasTechnicalDetail && (
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">Extraction details</summary>
          <div className="mt-1 space-y-1 pl-3">
            <p>OCR used: {envelope.ocrUsed ? "Yes" : "No"}</p>
            {envelope.charCount > 0 && <p>{envelope.charCount.toLocaleString()} characters extracted</p>}
            {caseNameConfidence && caseNameConfidence !== "high" && (
              <p className="text-amber-700 dark:text-amber-400">
                {caseNameConfidence === "low"
                  ? "Case name confidence: Low — the proposed case name was not confident enough to auto-fill. Please verify it against the document text before publishing."
                  : "Case name confidence: None — no case name could be confidently identified. Please enter it manually."}
              </p>
            )}
            {envelope.warnings.length > 0 && (
              <ul className="list-inside list-disc space-y-0.5 text-amber-700 dark:text-amber-400">
                {envelope.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Compact chip-based tag reviewer shared by both Review Queue cards (§15/
 * §16): proposed tags from deterministic extraction (import_jobs.
 * proposed_tags) plus any already-applied canonical tags are shown as
 * toggleable chips; the reviewer can also add a free-text tag. Nothing is
 * written until "Save tags" is pressed — extraction proposes, it never
 * silently classifies.
 */
function TagReviewEditor({
  proposed,
  applied,
  onSave,
  isSaving,
}: {
  proposed: string[];
  applied: string[];
  onSave: (names: string[]) => void;
  isSaving: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(applied));
  const [customTag, setCustomTag] = useState("");
  const [allNames, setAllNames] = useState<string[]>(() =>
    Array.from(new Set([...applied, ...proposed])),
  );
  // `applied` loads asynchronously (a separate query from the review-queue
  // row itself) — resync once it arrives rather than freezing on the
  // empty-array value captured at first mount, so previously-saved tags
  // for a draft the reviewer returns to show as already checked.
  const [syncedApplied, setSyncedApplied] = useState(applied);
  useEffect(() => {
    if (applied.length !== syncedApplied.length || applied.some((t) => !syncedApplied.includes(t))) {
      setSelected(new Set(applied));
      setAllNames((prev) => Array.from(new Set([...prev, ...applied, ...proposed])));
      setSyncedApplied(applied);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);
  const dirty =
    selected.size !== applied.length || [...selected].some((t) => !applied.includes(t));

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function addCustom() {
    const name = customTag.trim();
    if (!name) return;
    if (!allNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
      setAllNames((prev) => [...prev, name]);
    }
    setSelected((prev) => new Set(prev).add(name));
    setCustomTag("");
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Tags {proposed.length > 0 && "— proposed from document text, review before saving"}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {allNames.length === 0 && (
          <span className="text-xs text-muted-foreground">No tags proposed.</span>
        )}
        {allNames.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => toggle(name)}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              selected.has(name)
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {selected.has(name) ? "✓ " : "+ "}
            {name}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={customTag}
          onChange={(e) => setCustomTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="Add a tag…"
          className="h-8 text-xs"
        />
        <Button size="sm" variant="outline" className="h-8" onClick={addCustom}>
          Add
        </Button>
        {dirty && (
          <Button size="sm" className="h-8" disabled={isSaving} onClick={() => onSave([...selected])}>
            Save tags
          </Button>
        )}
      </div>
    </div>
  );
}

function OriginalDocumentLink({ documentId }: { documentId: string | null }) {
  const [loading, setLoading] = useState(false);
  if (!documentId) {
    return (
      <p className="text-xs text-muted-foreground">
        No original file attached — attach one from New Import, or paste text only.
      </p>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-xs"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          const { data, error } = await supabase
            .from("documents")
            .select("file_path")
            .eq("id", documentId)
            .single();
          if (error || !data) throw error ?? new Error("Document not found.");
          const url = await getDocumentViewUrl(data.file_path);
          window.open(url, "_blank", "noopener,noreferrer");
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not open the original file.");
        } finally {
          setLoading(false);
        }
      }}
    >
      <Download className="h-3.5 w-3.5" />
      Original file
    </Button>
  );
}

/**
 * Admin/curator Legal Library workspace — Sources / New Import / Review
 * Queue, per the ingestion architecture (0055 migration + legal-extraction.ts
 * + use-legal-sources.ts/use-import-jobs.ts). Deliberately not in the
 * ordinary magistrate sidebar (route is admin-role-gated, see router.tsx
 * and nav-config.ts).
 *
 * Honesty notes surfaced directly in this UI (never silently glossed over):
 * - No PDF/DOCX text extraction library is available in this build. A
 *   .txt upload is read automatically; PDF/DOCX require the curator to
 *   paste text (e.g. copied from the in-app PDF viewer).
 * - URL/source-adapter fetching is NOT implemented (no verified safe
 *   server-side fetch infrastructure in this environment) — Sources here
 *   are a reviewable REGISTRY only; adding one does not trigger a crawl.
 * - Tag proposals are keyword/rule-based, not AI. No AI classification is
 *   configured in this build.
 */
export default function LegalLibraryAdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Legal Library
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage source registrations, ingest Case Law and Legislation, and
          review drafts before they become canonical.
        </p>
      </div>

      <Tabs defaultValue="import">
        <TabsList>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="import">New Import</TabsTrigger>
          <TabsTrigger value="review">Review Queue</TabsTrigger>
        </TabsList>
        <TabsContent value="sources">
          <SourcesTab />
        </TabsContent>
        <TabsContent value="import">
          <ImportTab />
        </TabsContent>
        <TabsContent value="review">
          <ReviewQueueTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const SOURCE_STATUS_VARIANT: Record<string, "outline" | "default" | "secondary" | "destructive"> = {
  proposed: "outline",
  testing: "secondary",
  approved: "default",
  disabled: "outline",
  failed: "destructive",
};

function SourcesTab() {
  const { data: sources, isPending } = useLegalSources();
  const createSource = useCreateLegalSource();
  const deleteSource = useDeleteLegalSource();
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    jurisdiction: "",
    base_url: "",
    source_type: "case_law",
    connector_type: "manual",
    canonical_trusted: false,
    notes: "",
  });

  function reset() {
    setForm({
      name: "",
      jurisdiction: "",
      base_url: "",
      source_type: "case_law",
      connector_type: "manual",
      canonical_trusted: false,
      notes: "",
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Source registry</CardTitle>
            <CardDescription>
              A record that a source is intended to be used — not an active
              crawler. Adding a source here does not fetch anything; there is
              no automated connector wired up in this build (source/URL
              ingestion here is manual paste-and-submit only, see New
              Import).
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setOpen((o) => !o)}>
            <Plus className="h-4 w-4" />
            Add source
          </Button>
        </CardHeader>
        {open && (
          <CardContent className="space-y-3 border-t border-border pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                placeholder="Name (e.g. Guyana Ministry of Legal Affairs)"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              <Input
                placeholder="Jurisdiction (e.g. Guyana)"
                value={form.jurisdiction}
                onChange={(e) => setForm((f) => ({ ...f, jurisdiction: e.target.value }))}
              />
              <Input
                placeholder="Base URL"
                value={form.base_url}
                onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
              />
              <Select
                value={form.source_type}
                onChange={(e) => setForm((f) => ({ ...f, source_type: e.target.value }))}
              >
                <option value="case_law">Case Law source</option>
                <option value="legislation">Legislation source</option>
                <option value="mixed">Mixed (both)</option>
              </Select>
              <Select
                value={form.connector_type}
                onChange={(e) => setForm((f) => ({ ...f, connector_type: e.target.value }))}
              >
                <option value="manual">Manual (no automated connector)</option>
                <option value="direct_document">Direct document</option>
                <option value="html_document">HTML document</option>
                <option value="index_page">Index page</option>
                <option value="structured_feed">Structured feed</option>
                <option value="custom_adapter">Custom adapter</option>
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.canonical_trusted}
                  onCheckedChange={(c) => setForm((f) => ({ ...f, canonical_trusted: c }))}
                />
                Canonical / trusted source
              </label>
            </div>
            <Textarea
              placeholder="Notes — access terms, reliability, format quirks…"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setOpen(false); reset(); }}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!form.name.trim() || !form.jurisdiction.trim() || createSource.isPending}
                onClick={() =>
                  createSource.mutate(
                    {
                      name: form.name.trim(),
                      jurisdiction: form.jurisdiction.trim(),
                      base_url: form.base_url.trim() || null,
                      source_type: form.source_type,
                      connector_type: form.connector_type,
                      canonical_trusted: form.canonical_trusted,
                      notes: form.notes.trim() || null,
                      status: "proposed",
                    },
                    { onSuccess: () => { setOpen(false); reset(); } },
                  )
                }
              >
                Save source
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : !sources || sources.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Landmark}
              className="border-0"
              title="No sources registered"
              description="Register a legal source to track its status and reference it from imports."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sources.map((s) => (
            <Card key={s.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{s.name}</p>
                    <Badge variant={SOURCE_STATUS_VARIANT[s.status] ?? "outline"}>
                      {s.status}
                    </Badge>
                    {s.canonical_trusted && <Badge variant="canonical">Trusted</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[s.jurisdiction, s.source_type, s.connector_type].filter(Boolean).join(" · ")}
                    {s.base_url ? ` · ${s.base_url}` : ""}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove source"
                  onClick={() => setDeleteTarget(s.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Remove this source?"
        description="This removes the source registry entry. Any Case Law/Legislation already imported referencing it keeps its own recorded provenance (source name/URL are stored on the record itself, not only via this reference)."
        confirmLabel="Remove"
        confirmVariant="destructive"
        isConfirming={deleteSource.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteSource.mutate(deleteTarget, { onSuccess: () => setDeleteTarget(null) });
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// New Import
// ---------------------------------------------------------------------------

const EMPTY_CASE_FIELDS = { case_name: "", citation: "", decided_date: "" };
const EMPTY_STATUTE_FIELDS = { code: "", title: "", short_title: "" };

function ImportTab() {
  // Single-document import (the original flow) vs. Bulk import (Section
  // 10-13: select 1, 20, 200, or a whole folder at once). Deliberately a
  // sub-mode of the same tab rather than a brand-new top-level tab — New
  // Import is still fundamentally one workflow with two entry points, and
  // single-document import must not become more cumbersome to reach.
  const [importMode, setImportMode] = useState<"single" | "bulk">("single");

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-md border border-border p-0.5">
        <button
          type="button"
          onClick={() => setImportMode("single")}
          className={`rounded px-3 py-1.5 text-sm transition-colors ${
            importMode === "single" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          Single document
        </button>
        <button
          type="button"
          onClick={() => setImportMode("bulk")}
          className={`rounded px-3 py-1.5 text-sm transition-colors ${
            importMode === "bulk" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          Bulk import
        </button>
      </div>
      {importMode === "single" ? <SingleImportPanel /> : <BulkImportPanel />}
    </div>
  );
}

function SingleImportPanel() {
  const [contentType, setContentType] = useState<"case_law" | "legislation">("case_law");
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceId, setSourceId] = useState<string>("");
  const [courtId, setCourtId] = useState<string>("");
  const [jurisdictionId, setJurisdictionId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [extractionEnvelope, setExtractionEnvelope] = useState<ExtractionEnvelope>(emptyExtractionEnvelope());
  /** Case-name metadata confidence for the CURRENT file (Phase 3/8) — surfaced live in the New Import panel, not just after the draft is created. `null` = not yet computed / no case name found at all. */
  const [caseNameConfidence, setCaseNameConfidence] = useState<"high" | "low" | "none" | null>(null);
  // Case name/citation/decided date are the only free-text metadata the
  // curator ever types for Case Law now — Court/Jurisdiction are captured
  // ONCE via the canonical selects below, never as a second parallel
  // free-text pair (§2/§25: "should not have to catalog the same legal
  // authority twice").
  const [caseFields, setCaseFields] = useState(EMPTY_CASE_FIELDS);
  const [statuteFields, setStatuteFields] = useState(EMPTY_STATUTE_FIELDS);

  const ingestCaseLaw = useIngestCaseLaw();
  const ingestLegislation = useIngestLegislation();
  const { data: sources } = useLegalSources();
  const { data: jurisdictions } = useLegalJurisdictions();
  const { data: courts } = useLegalAuthorityCourts();
  const navigate = useNavigate();

  // Source selection is about PROVENANCE (which repository the document
  // came from) and is entirely separate from Jurisdiction/Court (which
  // court decided the case) — §7/§8/§12. A source may be left unassigned.
  const approvedSources = (sources ?? []).filter((s) => s.status === "approved");
  const otherSources = (sources ?? []).filter((s) => s.status !== "approved");

  const selectedCourt = (courts ?? []).find((c) => c.id === courtId) ?? null;

  /** Selecting a canonical Court auto-populates Jurisdiction where the court has one on file (§3/§4) — a national court like "Court of Appeal of Guyana" always carries its Jurisdiction; a regional/supranational court (CCJ, JCPC) has `jurisdiction_id: null` in the catalogue and is deliberately left for the curator to set explicitly rather than forcing one nation onto it. */
  function handleCourtChange(newCourtId: string) {
    setCourtId(newCourtId);
    const court = (courts ?? []).find((c) => c.id === newCourtId);
    if (court?.jurisdiction_id) {
      setJurisdictionId(court.jurisdiction_id);
    }
  }

  /**
   * DATA-INTEGRITY FIX (holistic ingestion repair, Phase 2): confirmed live
   * bug — after a PDF's text/metadata was successfully extracted, selecting
   * a DIFFERENT PDF that failed to extract left the FIRST document's case
   * name, citation, court, and jurisdiction sitting in the form, with
   * nothing to indicate they belonged to a different file. A curator could
   * then unknowingly publish File B's original document paired with File
   * A's metadata. This must be impossible: every field derived from a
   * previously selected file is cleared SYNCHRONOUSLY, before any async
   * extraction work starts for the new file — never conditionally, never
   * only on the success path. Source Repository (`sourceId`) is the one
   * deliberately-selected piece of provenance that survives a file switch
   * (a curator legitimately batches several documents from the same
   * repository); Source URL is per-document and is cleared with everything
   * else.
   */
  function resetFileDerivedState() {
    setText("");
    setSourceUrl("");
    setCourtId("");
    setJurisdictionId("");
    setCaseFields(EMPTY_CASE_FIELDS);
    setStatuteFields(EMPTY_STATUTE_FIELDS);
    setExtractionEnvelope(emptyExtractionEnvelope());
    setCaseNameConfidence(null);
  }

  async function handleFile(f: File) {
    resetFileDerivedState();
    // The original file is ALWAYS kept and uploaded through the secure
    // documents Storage architecture on submit (uploadDocumentToEntity,
    // private bucket, signed URLs only) — selecting a PDF/DOCX never
    // discards the file itself, and a failed/low-quality extraction never
    // prevents the file from being preserved.
    setFile(f);
    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    const isTxt = f.type === "text/plain" || f.name.toLowerCase().endsWith(".txt");

    if (isTxt) {
      const raw = await readFileAsText(f);
      const envelope = buildTextFileEnvelope(raw);
      applyExtractionResult(envelope);
      toast.success("Original file will be uploaded and preserved. Text read automatically from the .txt file.");
      return;
    }

    if (!isPdf) {
      toast.message(
        "Original file will be uploaded and preserved. Automatic text extraction is only available for .txt and text-bearing .pdf files — paste the extracted text below to continue (or leave blank and paste it later from the Review Queue).",
      );
      return;
    }

    setExtractionEnvelope((prev) => ({ ...prev, status: "pending" }));
    const envelope = await runPdfExtractionPipeline(f);
    applyExtractionResult(envelope);

    if (envelope.status === "extracted" || envelope.status === "low_quality") {
      toast.success(
        envelope.status === "extracted"
          ? "Text extracted from the PDF's text layer. Citation, Case name, and Court/Jurisdiction were proposed below where confidently identified — review before creating the draft."
          : "Text extracted, but the quality gate flagged it as low confidence — review it carefully below before creating the draft.",
      );
      if (contentType === "case_law") {
        const normalizedPages = envelope.pages.map((p) => ({ pageNumber: p.pageNumber, text: normalizeWhitespace(p.text) }));
        const { fields: proposed, caseNameConfidence: computedConfidence } = extractCaseLawMetadataWithConfidence(
          normalizeWhitespace(envelope.text),
          normalizedPages,
        );
        setCaseNameConfidence(computedConfidence);
        // Phase 3 (Task 4): a case-name PROPOSAL is only auto-filled into
        // the form when it is high confidence (anchored to a citation
        // near the very start of the extracted text). A low-confidence
        // proposal is real information but must not be silently treated
        // as if the machine were sure — "DO NOT AUTOMATICALLY PROPOSE
        // LEGAL METADATA FROM TEXT UNLESS THE SYSTEM HAS REASONABLE
        // EVIDENCE THAT THE TEXT IS ACTUALLY USABLE." The curator sees
        // the full extracted text below regardless and can copy the name
        // themselves if the low-confidence guess does happen to be right.
        setCaseFields({
          case_name: computedConfidence === "high" ? (proposed.case_name ?? "") : "",
          citation: proposed.reported_citation ?? proposed.neutral_citation ?? "",
          decided_date: proposed.decided_date_guess ?? "",
        });
        if (proposed.case_name && computedConfidence !== "high") {
          toast.message(
            `A possible case name was found ("${proposed.case_name}") but was not confident enough to auto-fill — please review the extracted text and enter the case name manually.`,
          );
        }
        // Only auto-select on "high"/"medium" confidence — a mention of
        // some other court deep in the judgment body (a common pattern:
        // Caribbean appellate judgments discussing further appeal rights
        // to the Privy Council) must never outrank an explicit
        // deciding-court heading, and a low-confidence guess is worse
        // than leaving Court for the curator to set (§10).
        const matched = matchCanonicalCourtScored(envelope.text, courts ?? []);
        if (matched && matched.confidence !== "low") {
          setCourtId(matched.court.id);
          if (matched.court.jurisdiction_id) setJurisdictionId(matched.court.jurisdiction_id);
          if (matched.confidence === "medium") {
            toast.message(
              `Court proposed from extracted text: ${matched.court.canonical_name} — please confirm before publishing.`,
            );
          }
        }
      }
      // Legislation: no automatic Act title/code proposal exists yet —
      // deliberately not inventing a fixture-driven heuristic for this
      // pass (Phase 12 wires the SAME extraction/quality/sanitize
      // pipeline into Legislation ingestion; structural parsing of
      // Parts/Sections already runs downstream in useIngestLegislation
      // over whatever text this produces).
      return;
    }

    if (envelope.status === "requires_ocr") {
      toast.message(
        "This document requires OCR. The original file has been preserved, but reliable text could not be extracted automatically — paste the text below to continue, or leave it for later.",
      );
    } else if (envelope.status === "failed") {
      toast.warning(
        "Automatic extraction produced text that failed quality checks (it looks like embedded PDF/font data rather than document content) and was discarded. The original file has been preserved — paste the text below to continue.",
      );
    }
  }

  function applyExtractionResult(envelope: ExtractionEnvelope) {
    setExtractionEnvelope(envelope);
    setText(envelope.text);
  }

  /** Curator typing/pasting directly into Document text is trusted manual input, not a machine proposal — tracked as its own extraction method so the Review Queue shows "Manually entered" rather than a stale PDF-extraction status once the curator starts editing. */
  function handleTextChange(value: string) {
    setText(value);
    if (extractionEnvelope.method !== "manual_paste") {
      setExtractionEnvelope(buildManualPasteEnvelope(value));
    }
  }

  const canSubmitCaseLaw = caseFields.citation.trim() && courtId && jurisdictionId;
  const canSubmitStatute =
    statuteFields.code.trim() && statuteFields.title.trim() && jurisdictionId;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deterministic ingestion — no AI</CardTitle>
          <CardDescription>
            Hashing, citation/date/section-heading parsing, and canonical tag
            proposals run automatically over the text below. Nothing is
            published immediately — this creates a draft record sent to the
            Review Queue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={contentType}
              onChange={(e) => setContentType(e.target.value as "case_law" | "legislation")}
              className="max-w-xs"
            >
              <option value="case_law">Case Law</option>
              <option value="legislation">Legislation</option>
            </Select>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
              <Upload className="h-4 w-4" />
              Upload file
              <input
                type="file"
                className="hidden"
                accept=".txt,.pdf,.doc,.docx"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
            </label>
            {file && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                {file.name} — will be uploaded and preserved
              </span>
            )}
            {extractionEnvelope.status === "pending" && file && (
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="h-3 w-3" />
                Extracting text…
              </Badge>
            )}
          </div>

          {file && extractionEnvelope.status !== "pending" && (
            <ExtractionStatusPanel
              envelope={extractionEnvelope}
              caseNameConfidence={contentType === "case_law" ? caseNameConfidence : null}
            />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Source URL" hint="Optional — provenance only, not fetched.">
              <Input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
              />
            </Field>
            <Field label="Source repository" hint="Where the document came from — does not decide the Jurisdiction or Court below.">
              <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                <option value="">Unassigned</option>
                {approvedSources.length > 0 && (
                  <optgroup label="Approved">
                    {approvedSources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {otherSources.length > 0 && (
                  <optgroup label="Not yet approved">
                    {otherSources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.status})
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
            </Field>
          </div>

          {contentType === "case_law" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Case name" hint="Proposed from extracted text if left blank.">
                <Input
                  value={caseFields.case_name}
                  onChange={(e) => setCaseFields((f) => ({ ...f, case_name: e.target.value }))}
                />
              </Field>
              <Field label="Citation" required>
                <Input
                  value={caseFields.citation}
                  onChange={(e) => setCaseFields((f) => ({ ...f, citation: e.target.value }))}
                />
              </Field>
              <Field label="Decision date">
                <DateOnlyInput
                  value={caseFields.decided_date}
                  onChange={(v) => setCaseFields((f) => ({ ...f, decided_date: v }))}
                />
              </Field>
              <Field
                label="Jurisdiction"
                required
                hint={
                  selectedCourt?.jurisdiction_id
                    ? "Auto-set from the selected Court."
                    : "This court spans multiple jurisdictions — set explicitly."
                }
              >
                <Select value={jurisdictionId} onChange={(e) => setJurisdictionId(e.target.value)}>
                  <option value="">Select Jurisdiction — needs review</option>
                  {(jurisdictions ?? []).map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Court" required hint="Selecting a Court automatically sets Jurisdiction where known — no need to enter both.">
                <Select value={courtId} onChange={(e) => handleCourtChange(e.target.value)}>
                  <option value="">Select deciding Court — needs review</option>
                  {(courts ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.canonical_name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Code" required hint="Short identifier, unique per jurisdiction.">
                <Input
                  value={statuteFields.code}
                  onChange={(e) => setStatuteFields((f) => ({ ...f, code: e.target.value }))}
                />
              </Field>
              <Field label="Title" required>
                <Input
                  value={statuteFields.title}
                  onChange={(e) => setStatuteFields((f) => ({ ...f, title: e.target.value }))}
                />
              </Field>
              <Field label="Short title">
                <Input
                  value={statuteFields.short_title}
                  onChange={(e) => setStatuteFields((f) => ({ ...f, short_title: e.target.value }))}
                />
              </Field>
              <Field label="Jurisdiction" required>
                <Select value={jurisdictionId} onChange={(e) => setJurisdictionId(e.target.value)}>
                  <option value="">Select Jurisdiction — needs review</option>
                  {(jurisdictions ?? []).map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}

          <Field label="Document text" hint="Auto-read for .txt uploads and text-bearing PDFs; paste manually otherwise.">
            <Textarea
              value={text}
              onChange={(e) => handleTextChange(e.target.value)}
              rows={10}
            />
          </Field>
          {!text.trim() && !file && (
            <p className="text-xs text-muted-foreground">
              Provide either document text or an original file (or both) before creating the draft.
            </p>
          )}

          <div className="flex justify-end">
            {contentType === "case_law" ? (
              <Button
                disabled={
                  !canSubmitCaseLaw || (!text.trim() && !file) || ingestCaseLaw.isPending
                }
                onClick={() =>
                  ingestCaseLaw.mutate(
                    {
                      text,
                      file,
                      extractionEnvelope,
                      source_url: sourceUrl.trim() || null,
                      source_id: sourceId || null,
                      original_filename: file?.name ?? null,
                      batch_id: null,
                      known: {
                        case_name: caseFields.case_name.trim() || undefined,
                        citation: caseFields.citation.trim(),
                        // Legacy free-text columns are NOT typed separately by
                        // the curator — they're derived automatically from
                        // the canonical selection above (§2/§3/§19: the
                        // NOT NULL free-text columns stay populated for
                        // backward compatibility without ever asking the
                        // curator to catalog the same Court/Jurisdiction
                        // twice).
                        court: (courts ?? []).find((c) => c.id === courtId)?.canonical_name ?? "",
                        jurisdiction: (jurisdictions ?? []).find((j) => j.id === jurisdictionId)?.name ?? "",
                        court_id: courtId || null,
                        jurisdiction_id: jurisdictionId || null,
                        decided_date: caseFields.decided_date || null,
                      },
                    },
                    {
                      onSuccess: (result) => navigate(ROUTES.caseLawDetail(result.caseLawId)),
                    },
                  )
                }
              >
                <FileText className="h-4 w-4" />
                Create draft Case Law record
              </Button>
            ) : (
              <Button
                disabled={
                  !canSubmitStatute || (!text.trim() && !file) || ingestLegislation.isPending
                }
                onClick={() =>
                  ingestLegislation.mutate(
                    {
                      text,
                      file,
                      extractionEnvelope,
                      source_url: sourceUrl.trim() || null,
                      source_id: sourceId || null,
                      original_filename: file?.name ?? null,
                      batch_id: null,
                      known: {
                        code: statuteFields.code.trim(),
                        title: statuteFields.title.trim(),
                        jurisdiction: (jurisdictions ?? []).find((j) => j.id === jurisdictionId)?.name ?? "",
                        short_title: statuteFields.short_title.trim() || undefined,
                        jurisdiction_id: jurisdictionId || null,
                      },
                    },
                    {
                      onSuccess: (result) => navigate(ROUTES.legislationDetail(result.statuteId)),
                    },
                  )
                }
              >
                <ScrollText className="h-4 w-4" />
                Create draft Act
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const BULK_STATUS_TONE: Record<BulkItemStatus, "canonical" | "destructive" | "outline" | "secondary"> = {
  queued: "secondary",
  hashing: "secondary",
  duplicate: "outline",
  extracting: "secondary",
  needs_review: "outline",
  ready: "canonical",
  failed: "destructive",
  completed: "canonical",
  rejected: "destructive",
};

function BulkSummaryChip({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "canonical" | "destructive" | "outline" | "secondary";
}) {
  if (count === 0) return null;
  return (
    <Badge variant={tone} className="gap-1">
      {label}: {count}
    </Badge>
  );
}

/**
 * Bulk import — Case Law only for this pass (Section 22: the architecture
 * is generic, but only Case Law's per-file metadata proposal is wired into
 * the bulk worker so far; Legislation's structural Part/Section parsing
 * stays on the single-document flow). Deliberately reuses the exact same
 * per-file pipeline as SingleImportPanel via useBulkImportCaseLaw — see
 * that hook's doc comment. Every file becomes its own draft in the Review
 * Queue; nothing here ever publishes anything (Section 3/21: "BULK
 * INGESTION IS NOT BULK PUBLICATION").
 */
function BulkImportPanel() {
  const { items, isRunning, startBulkImport, reset } = useBulkImportCaseLaw();
  const [sourceId, setSourceId] = useState<string>("");
  const { data: sources } = useLegalSources();
  const { data: jurisdictions } = useLegalJurisdictions();
  const { data: courts } = useLegalAuthorityCourts();
  const navigate = useNavigate();

  const approvedSources = (sources ?? []).filter((s) => s.status === "approved");
  const otherSources = (sources ?? []).filter((s) => s.status !== "approved");

  const summary = summarizeBulkQueue(items);
  const hasItems = items.length > 0;

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    void startBulkImport(files, {
      sourceId: sourceId || null,
      courts: courts ?? [],
      jurisdictions: (jurisdictions ?? []).map((j) => ({ id: j.id, name: j.name })),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bulk import — Case Law</CardTitle>
        <CardDescription>
          Select many judgments at once — individual files or an entire folder. Each file is preserved,
          hashed, and processed independently with bounded concurrency; one bad file never stops the batch.
          Every file becomes its own draft in the Review Queue — nothing is published automatically.
          Legislation bulk import isn&apos;t available yet; use Single document for Acts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field
          label="Source repository"
          hint="Applied to every file in this batch — does not decide Jurisdiction or Court."
        >
          <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="max-w-xs">
            <option value="">Unassigned</option>
            {approvedSources.length > 0 && (
              <optgroup label="Approved">
                {approvedSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            )}
            {otherSources.length > 0 && (
              <optgroup label="Not yet approved">
                {otherSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.status})
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <label
            className={`inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted ${
              isRunning ? "pointer-events-none opacity-50" : "cursor-pointer"
            }`}
          >
            <Upload className="h-4 w-4" />
            Upload files
            <input
              type="file"
              multiple
              accept=".txt,.pdf"
              className="hidden"
              disabled={isRunning}
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <label
            className={`inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted ${
              isRunning ? "pointer-events-none opacity-50" : "cursor-pointer"
            }`}
          >
            <FolderUp className="h-4 w-4" />
            Upload folder
            <input
              type="file"
              multiple
              // Non-standard attribute, not in React's JSX typings, but
              // supported by Chromium/Firefox/Safari file pickers — where
              // unsupported it degrades to a normal multi-file picker, so
              // basic multi-file selection still works everywhere (§10:
              // folder selection must not be the ONLY mechanism).
              // @ts-expect-error -- webkitdirectory is non-standard
              webkitdirectory=""
              className="hidden"
              disabled={isRunning}
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          {isRunning && (
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="h-3 w-3" />
              Processing…
            </Badge>
          )}
          {hasItems && !isRunning && (
            <Button size="sm" variant="ghost" onClick={reset}>
              Clear
            </Button>
          )}
        </div>

        {hasItems && (
          <>
            <div className="flex flex-wrap gap-1.5">
              <BulkSummaryChip label="Ready" count={summary.ready + summary.completed} tone="canonical" />
              <BulkSummaryChip label="Needs review" count={summary.needs_review} tone="outline" />
              <BulkSummaryChip label="Duplicates" count={summary.duplicate} tone="outline" />
              <BulkSummaryChip
                label="Processing"
                count={summary.queued + summary.hashing + summary.extracting}
                tone="secondary"
              />
              <BulkSummaryChip label="Failed" count={summary.failed} tone="destructive" />
              <BulkSummaryChip label="Rejected" count={summary.rejected} tone="destructive" />
            </div>

            <div className="max-h-[28rem] space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium text-foreground">{item.file.name}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.error && (
                      <span className="max-w-[16rem] truncate text-destructive" title={item.error}>
                        {item.error}
                      </span>
                    )}
                    {item.duplicateReason && (
                      <span className="max-w-[16rem] truncate text-muted-foreground" title={item.duplicateReason}>
                        {item.duplicateReason}
                      </span>
                    )}
                    <Badge variant={BULK_STATUS_TONE[item.status]}>{BULK_STATUS_LABEL[item.status]}</Badge>
                    {item.caseLawId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => navigate(ROUTES.caseLawDetail(item.caseLawId!))}
                      >
                        View
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Review Queue
// ---------------------------------------------------------------------------

/**
 * Review Queue scaling (Section 19/20): bulk ingestion can put hundreds of
 * drafts here, and one giant flat list of full editable cards does not
 * scale. Rather than a new query, a new schema, or a wholesale redesign
 * (Section 19: "make the smallest architectural/UI change required"),
 * this filters the SAME already-fetched rows client-side into named
 * buckets with counts — mirroring the example vocabulary from the spec
 * ("Needs Review (38), Ready to Publish (105), OCR Required (41), Failed
 * (3), Possible Duplicates (13)"). Opening a card for full editing is
 * unchanged.
 *
 * Bucket priority is deliberately a strict, mutually-exclusive ladder so
 * every row lands in exactly one tab (besides "All"): a failed extraction
 * is more actionable to know about than a duplicate warning, which is more
 * urgent than "just needs a Court/Jurisdiction pick." This ordering is a
 * triage convenience for the filter tabs only — it does not change what a
 * curator sees once a card is open (every relevant warning is still shown
 * there regardless of which bucket it landed in here).
 */
type ReviewCategory = "failed" | "ocr_required" | "possible_duplicate" | "ready_to_publish" | "needs_review";

const REVIEW_CATEGORY_LABEL: Record<ReviewCategory, string> = {
  needs_review: "Needs review",
  ready_to_publish: "Ready to publish",
  ocr_required: "OCR required",
  possible_duplicate: "Possible duplicates",
  failed: "Failed",
};

const REVIEW_CATEGORY_ORDER: ReviewCategory[] = [
  "needs_review",
  "ready_to_publish",
  "ocr_required",
  "possible_duplicate",
  "failed",
];

function categorizeCaseLawRow(row: ReviewRow<CaseLaw>): ReviewCategory {
  const envelope = readExtractionEnvelope(row.extracted_metadata);
  if (row.job_error_summary || envelope?.status === "failed") return "failed";
  if (envelope?.status === "requires_ocr") return "ocr_required";
  if (row.duplicate_warning) return "possible_duplicate";
  const errors = validateCaseLawForPublish({
    case_name: row.case_name,
    citation: row.citation,
    court: row.court,
    jurisdiction: row.jurisdiction,
    court_id: row.court_id,
    jurisdiction_id: row.jurisdiction_id,
  });
  return errors.length === 0 ? "ready_to_publish" : "needs_review";
}

function categorizeStatuteRow(row: ReviewRow<Statute>): ReviewCategory {
  const envelope = readExtractionEnvelope(row.extracted_metadata);
  if (row.job_error_summary || envelope?.status === "failed") return "failed";
  if (envelope?.status === "requires_ocr") return "ocr_required";
  if (row.duplicate_warning) return "possible_duplicate";
  const errors = validateLegislationForPublish({
    code: row.code,
    title: row.title,
    jurisdiction: row.jurisdiction,
    jurisdiction_id: row.jurisdiction_id,
  });
  return errors.length === 0 ? "ready_to_publish" : "needs_review";
}

function ReviewQueueTab() {
  const { data: caseLawQueue, isPending: caseLawPending } = useCaseLawReviewQueue();
  const { data: statuteQueue, isPending: statutePending } = useLegislationReviewQueue();
  const [activeCategory, setActiveCategory] = useState<ReviewCategory | "all">("all");

  const caseLawCategorized = (caseLawQueue ?? []).map((row) => ({ row, category: categorizeCaseLawRow(row) }));
  const statuteCategorized = (statuteQueue ?? []).map((row) => ({ row, category: categorizeStatuteRow(row) }));

  const counts: Record<ReviewCategory, number> = {
    needs_review: 0,
    ready_to_publish: 0,
    ocr_required: 0,
    possible_duplicate: 0,
    failed: 0,
  };
  for (const { category } of caseLawCategorized) counts[category] += 1;
  for (const { category } of statuteCategorized) counts[category] += 1;
  const totalCount = caseLawCategorized.length + statuteCategorized.length;

  const filteredCaseLaw =
    activeCategory === "all" ? caseLawCategorized : caseLawCategorized.filter((c) => c.category === activeCategory);
  const filteredStatute =
    activeCategory === "all" ? statuteCategorized : statuteCategorized.filter((c) => c.category === activeCategory);

  const activeLabel = activeCategory === "all" ? null : REVIEW_CATEGORY_LABEL[activeCategory].toLowerCase();

  return (
    <div className="space-y-6">
      {totalCount > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setActiveCategory("all")}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              activeCategory === "all"
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            All ({totalCount})
          </button>
          {REVIEW_CATEGORY_ORDER.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              disabled={counts[cat] === 0}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                activeCategory === cat
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {REVIEW_CATEGORY_LABEL[cat]} ({counts[cat]})
            </button>
          ))}
        </div>
      )}

      <div>
        <h2 className="text-lg font-medium text-foreground">Case Law</h2>
        {caseLawPending ? (
          <Skeleton className="mt-2 h-24 w-full" />
        ) : filteredCaseLaw.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {activeLabel ? `No Case Law drafts in "${activeLabel}".` : "No Case Law drafts awaiting review."}
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {filteredCaseLaw.map(({ row }) => (
              <CaseLawReviewCard key={row.id} row={row} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-medium text-foreground">Legislation</h2>
        {statutePending ? (
          <Skeleton className="mt-2 h-24 w-full" />
        ) : filteredStatute.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {activeLabel ? `No Legislation drafts in "${activeLabel}".` : "No Legislation drafts awaiting review."}
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {filteredStatute.map(({ row }) => (
              <StatuteReviewCard key={row.id} row={row} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CaseLawReviewCard({ row }: { row: ReviewRow<CaseLaw> }) {
  const navigate = useNavigate();
  const update = useUpdateCanonicalCaseLaw(row.id);
  const setStatus = useSetCaseLawReviewStatus();
  const reject = useRejectCanonicalCaseLaw();
  const { data: sources } = useLegalSources();
  const { data: jurisdictions } = useLegalJurisdictions();
  const { data: courts } = useLegalAuthorityCourts();
  const { data: appliedTags } = useCaseLawTags(row.id);
  const applyTags = useApplyCaseLawTags(row.id);
  const [fields, setFields] = useState({
    case_name: row.case_name,
    citation: row.citation,
    decided_date: row.decided_date ?? "",
    court_id: row.court_id,
    jurisdiction_id: row.jurisdiction_id,
  });
  const [confirmReject, setConfirmReject] = useState(false);
  const dirty =
    fields.case_name !== row.case_name ||
    fields.citation !== row.citation ||
    fields.decided_date !== (row.decided_date ?? "") ||
    fields.court_id !== row.court_id ||
    fields.jurisdiction_id !== row.jurisdiction_id;

  // Save-state reflects the mutation's own pending/success/error status —
  // never local "the user typed something" guessing (§17). Resets to
  // "idle" the moment a further edit is made so a stale "Saved" doesn't
  // linger over an un-persisted change.
  const saveState: SaveState = dirty
    ? "idle"
    : update.status === "pending"
      ? "saving"
      : update.status === "success"
        ? "saved"
        : update.status === "error"
          ? "error"
          : "idle";

  /** Selecting a canonical Court auto-populates Jurisdiction where the court has one on file (§3/§4) — regional/supranational courts (CCJ, JCPC) carry no fixed jurisdiction_id and are left for the curator to set explicitly. */
  function handleCourtChange(newCourtId: string) {
    const court = (courts ?? []).find((c) => c.id === newCourtId);
    setFields((f) => ({
      ...f,
      court_id: newCourtId || null,
      jurisdiction_id: court?.jurisdiction_id ?? f.jurisdiction_id,
    }));
  }

  function handleSave() {
    // Legacy free-text court/jurisdiction columns are never edited
    // directly in this card — they're derived automatically from the
    // canonical selection whenever it changes, so the NOT NULL legacy
    // columns stay populated without the curator ever typing the same
    // Court/Jurisdiction twice (§2/§3/§19).
    const court = (courts ?? []).find((c) => c.id === fields.court_id)?.canonical_name ?? row.court;
    const jurisdiction =
      (jurisdictions ?? []).find((j) => j.id === fields.jurisdiction_id)?.name ?? row.jurisdiction;
    update.mutate({
      case_name: fields.case_name,
      citation: fields.citation,
      decided_date: fields.decided_date || null,
      court_id: fields.court_id,
      jurisdiction_id: fields.jurisdiction_id,
      court,
      jurisdiction,
    });
  }

  const selectedCourt = (courts ?? []).find((c) => c.id === fields.court_id) ?? null;
  const validationErrors = validateCaseLawForPublish({
    case_name: fields.case_name,
    citation: fields.citation,
    court: (courts ?? []).find((c) => c.id === fields.court_id)?.canonical_name ?? row.court,
    jurisdiction: (jurisdictions ?? []).find((j) => j.id === fields.jurisdiction_id)?.name ?? row.jurisdiction,
    court_id: fields.court_id,
    jurisdiction_id: fields.jurisdiction_id,
  });
  const canPublish = validationErrors.length === 0 && !dirty;

  const sourceName = row.source_id
    ? (sources ?? []).find((s) => s.id === row.source_id)?.name ?? "Unknown source"
    : null;
  const appliedTagNames = (appliedTags ?? [])
    .map((t) => (t.tags as unknown as { name: string } | null)?.name)
    .filter((n): n is string => !!n);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{row.case_name}</CardTitle>
            <Badge variant="outline">Case Law</Badge>
            {row.job_status && <Badge variant="secondary">{row.job_status}</Badge>}
            {isPlaceholderValue(row.case_name) && (
              <Badge variant="outline" className="gap-1 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                Case name requires review
              </Badge>
            )}
          </div>
          <CardDescription>
            {row.review_status === "needs_review" ? "Needs review" : "Draft"} · Created{" "}
            {formatDate(row.created_at)}
          </CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={() => navigate(ROUTES.caseLawDetail(row.id))}>
          View full record
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {row.duplicate_warning && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{row.duplicate_warning}</span>
          </div>
        )}

        {/* METADATA */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Case name" required>
            <Input
              value={fields.case_name}
              onChange={(e) => setFields((f) => ({ ...f, case_name: e.target.value }))}
            />
          </Field>
          <Field label="Citation" required>
            <Input
              value={fields.citation}
              onChange={(e) => setFields((f) => ({ ...f, citation: e.target.value }))}
            />
          </Field>
          <Field label="Decision date">
            <DateOnlyInput
              value={fields.decided_date}
              onChange={(v) => setFields((f) => ({ ...f, decided_date: v }))}
            />
          </Field>
          <div />
          <Field
            label="Jurisdiction"
            required
            hint={
              selectedCourt?.jurisdiction_id
                ? "Auto-set from the selected Court."
                : selectedCourt
                  ? "This court spans multiple jurisdictions — set explicitly."
                  : undefined
            }
          >
            <Select
              value={fields.jurisdiction_id ?? ""}
              onChange={(e) => setFields((f) => ({ ...f, jurisdiction_id: e.target.value || null }))}
            >
              <option value="">Select Jurisdiction — needs review</option>
              {(jurisdictions ?? []).map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Court" required hint="Selecting a Court automatically sets Jurisdiction where known.">
            <Select value={fields.court_id ?? ""} onChange={(e) => handleCourtChange(e.target.value)}>
              <option value="">Select deciding Court — needs review</option>
              {(courts ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.canonical_name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* CLASSIFICATION */}
        <TagReviewEditor
          proposed={row.proposed_tags}
          applied={appliedTagNames}
          isSaving={applyTags.isPending}
          onSave={(names) => applyTags.mutate(names)}
        />

        {/* EXTRACTION — what the machine determined and how confident it is (Phase 9) */}
        <ExtractionStatusPanel
          envelope={readExtractionEnvelope(row.extracted_metadata)}
          caseNameConfidence={readCaseNameConfidence(row.extracted_metadata)}
          caseNameSource={readCaseNameSource(row.extracted_metadata)}
        />
        {row.job_error_summary && (
          <p className="text-xs text-destructive">Import job error: {row.job_error_summary}</p>
        )}

        {/* PROVENANCE */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>Source repository: {sourceName ?? "unassigned"}</span>
          {row.source_url && (
            <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="underline">
              Source URL
            </a>
          )}
          <OriginalDocumentLink documentId={row.uploaded_document_id} />
        </div>

        {/* ACTIONS */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SaveIndicator state={saveState} onRetry={handleSave} />
          {dirty && (
            <Button size="sm" variant="outline" disabled={update.isPending} onClick={handleSave}>
              Save changes
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmReject(true)}
          >
            <XCircle className="h-4 w-4" />
            Reject
          </Button>
          <div className="flex flex-col items-end gap-1">
            <Button
              size="sm"
              disabled={!canPublish || setStatus.isPending}
              onClick={() => setStatus.mutate({ id: row.id, review_status: "published" })}
            >
              <CheckCircle2 className="h-4 w-4" />
              Publish
            </Button>
            {validationErrors.length > 0 && (
              <p className="max-w-xs text-right text-[11px] text-destructive">
                Cannot publish: {validationErrors.join(" ")}
              </p>
            )}
            {validationErrors.length === 0 && dirty && (
              <p className="text-[11px] text-muted-foreground">Save changes before publishing.</p>
            )}
          </div>
        </div>
      </CardContent>
      <AlertDialog
        open={confirmReject}
        onOpenChange={setConfirmReject}
        title="Reject this draft?"
        description="This permanently deletes the draft Case Law record and its attached documents. This cannot be undone."
        confirmLabel="Reject and delete"
        confirmVariant="destructive"
        isConfirming={reject.isPending}
        onConfirm={() =>
          reject.mutate(
            { id: row.id, reason: "Rejected by curator during review." },
            { onSuccess: () => setConfirmReject(false) },
          )
        }
      />
    </Card>
  );
}

function StatuteReviewCard({ row }: { row: ReviewRow<Statute> }) {
  const navigate = useNavigate();
  const update = useUpdateCanonicalStatute(row.id);
  const setStatus = useSetStatuteReviewStatus();
  const reject = useRejectCanonicalStatute();
  const { data: sources } = useLegalSources();
  const { data: jurisdictions } = useLegalJurisdictions();
  const { data: provisions } = useStatuteProvisions(row.id);
  const { data: appliedTags } = useStatuteTags(row.id);
  const applyTags = useApplyStatuteTags(row.id);
  const [fields, setFields] = useState({
    title: row.title,
    code: row.code,
    jurisdiction: row.jurisdiction,
    chapter_number: row.chapter_number ?? "",
    jurisdiction_id: row.jurisdiction_id,
  });
  const [confirmReject, setConfirmReject] = useState(false);
  const dirty =
    fields.title !== row.title ||
    fields.code !== row.code ||
    fields.jurisdiction !== row.jurisdiction ||
    fields.chapter_number !== (row.chapter_number ?? "") ||
    fields.jurisdiction_id !== row.jurisdiction_id;

  const sourceName = row.source_id
    ? (sources ?? []).find((s) => s.id === row.source_id)?.name ?? "Unknown source"
    : null;
  const appliedTagNames = (appliedTags ?? [])
    .map((t) => (t.tags as unknown as { name: string } | null)?.name)
    .filter((n): n is string => !!n);
  // Same "tiny shared fix" placeholder-metadata gate as Case Law (§6/§15)
  // — checked against the currently SAVED row, not the in-progress edit
  // buffer, since Publish is also disabled while `dirty` is true.
  const statuteValidationErrors = validateLegislationForPublish({
    code: row.code,
    title: row.title,
    jurisdiction: row.jurisdiction,
    jurisdiction_id: row.jurisdiction_id,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{row.title}</CardTitle>
            <Badge variant="outline">Legislation</Badge>
            {row.job_status && <Badge variant="secondary">{row.job_status}</Badge>}
          </div>
          <CardDescription>
            {row.review_status === "needs_review" ? "Needs review" : "Draft"} · Created{" "}
            {formatDate(row.created_at)} · {(provisions ?? []).length} provision(s) extracted
          </CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={() => navigate(ROUTES.legislationDetail(row.id))}>
          View full record
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {row.duplicate_warning && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{row.duplicate_warning}</span>
          </div>
        )}

        <ExtractionStatusPanel envelope={readExtractionEnvelope(row.extracted_metadata)} />
        {row.job_error_summary && (
          <p className="text-xs text-destructive">Import job error: {row.job_error_summary}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Source: {sourceName ?? "unassigned"}</span>
          {row.source_url && (
            <a href={row.source_url} target="_blank" rel="noopener noreferrer" className="underline">
              Source URL
            </a>
          )}
          <OriginalDocumentLink documentId={row.uploaded_document_id} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={fields.title}
            onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))}
            placeholder="Title"
          />
          <Input
            value={fields.code}
            onChange={(e) => setFields((f) => ({ ...f, code: e.target.value }))}
            placeholder="Code"
          />
          <Input
            value={fields.jurisdiction}
            onChange={(e) => setFields((f) => ({ ...f, jurisdiction: e.target.value }))}
            placeholder="Jurisdiction (free text)"
          />
          <Input
            value={fields.chapter_number}
            onChange={(e) => setFields((f) => ({ ...f, chapter_number: e.target.value }))}
            placeholder="Chapter number"
          />
          <Select
            value={fields.jurisdiction_id ?? ""}
            onChange={(e) => setFields((f) => ({ ...f, jurisdiction_id: e.target.value || null }))}
          >
            <option value="">Canonical Jurisdiction — needs review</option>
            {(jurisdictions ?? []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </Select>
        </div>

        <TagReviewEditor
          proposed={row.proposed_tags}
          applied={appliedTagNames}
          isSaving={applyTags.isPending}
          onSave={(names) => applyTags.mutate(names)}
        />

        <div className="flex flex-wrap items-center justify-end gap-2">
          {dirty && (
            <Button
              size="sm"
              variant="outline"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({ ...fields, chapter_number: fields.chapter_number || null })
              }
            >
              Save edits
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmReject(true)}
          >
            <XCircle className="h-4 w-4" />
            Reject
          </Button>
          <div className="flex flex-col items-end gap-1">
            <Button
              size="sm"
              disabled={statuteValidationErrors.length > 0 || dirty || setStatus.isPending}
              onClick={() => setStatus.mutate({ id: row.id, review_status: "published" })}
            >
              <CheckCircle2 className="h-4 w-4" />
              Publish
            </Button>
            {statuteValidationErrors.length > 0 && (
              <p className="max-w-xs text-right text-[11px] text-destructive">
                Cannot publish: {statuteValidationErrors.join(" ")}
              </p>
            )}
          </div>
        </div>
      </CardContent>
      <AlertDialog
        open={confirmReject}
        onOpenChange={setConfirmReject}
        title="Reject this draft?"
        description="This permanently deletes the draft Legislation record and its provisions. This cannot be undone."
        confirmLabel="Reject and delete"
        confirmVariant="destructive"
        isConfirming={reject.isPending}
        onConfirm={() =>
          reject.mutate(
            { id: row.id, reason: "Rejected by curator during review." },
            { onSuccess: () => setConfirmReject(false) },
          )
        }
      />
    </Card>
  );
}
